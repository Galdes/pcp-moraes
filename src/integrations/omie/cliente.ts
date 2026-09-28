// Cliente da API do Omie com as proteções que os limites dela exigem:
// - no máximo N chamadas por minuto por método (padrão 200; Omie permite 240)
// - no máximo 2 chamadas simultâneas por método (Omie permite 4)
// - limite diário opcional (planos Fit: 500/dia)
// - disjuntor: 3 erros seguidos pausam a integração por 10 min, antes de
//   chegar aos 10 erros que fazem o Omie bloquear por 30 min
// - "consumo redundante" (mesmo ID consultado em menos de 60 s) não conta como erro

import type { Contrato } from "./contratos";
import { hojeNoFuso } from "@/domain/datas";

export interface EstadoIntegracao {
  bloqueado_ate: Date | null;
  erros_consecutivos: number;
  dia: string | null;
  chamadas_dia: number;
}

export interface ArmazemEstado {
  ler(): Promise<EstadoIntegracao>;
  /** Lê o estado mais recente, aplica a mudança e grava, de forma atômica (chamadas em paralelo não se sobrescrevem). */
  atualizar(mudar: (e: EstadoIntegracao) => EstadoIntegracao, mensagem?: string): Promise<void>;
}

export class ErroOmie extends Error {
  constructor(
    msg: string,
    readonly tipo: "circuito" | "limite_diario" | "redundante" | "api" | "rede" | "configuracao",
    readonly detalhe?: unknown,
  ) {
    super(msg);
    this.name = "ErroOmie";
  }
}

export interface OpcoesCliente {
  appKey: string;
  appSecret: string;
  reqPorMinuto?: number;
  limiteDiario?: number; // 0 = sem limite
  concorrencia?: number;
  urlBase?: string;
  fetchFn?: typeof fetch;
  agora?: () => number;
  dormir?: (ms: number) => Promise<void>;
  estado: ArmazemEstado;
  errosParaAbrir?: number;
  pausaMin?: number;
}

export class ClienteOmie {
  private janelas = new Map<string, number[]>();
  private emUso = new Map<string, number>();
  private filas = new Map<string, (() => void)[]>();
  private o: Required<Omit<OpcoesCliente, "fetchFn">> & { fetchFn: typeof fetch };

  constructor(opcoes: OpcoesCliente) {
    if (!opcoes.appKey || !opcoes.appSecret) throw new ErroOmie("OMIE_APP_KEY/OMIE_APP_SECRET não configurados", "configuracao");
    this.o = {
      reqPorMinuto: 200,
      limiteDiario: 0,
      concorrencia: 2,
      urlBase: "https://app.omie.com.br/api/v1/",
      agora: () => Date.now(),
      dormir: (ms: number) => new Promise((r) => setTimeout(r, ms)),
      errosParaAbrir: 3,
      pausaMin: 10,
      ...opcoes,
      // opções passadas como undefined não podem apagar os padrões (ex.: fetchFn)
      fetchFn: opcoes.fetchFn ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    } as never;
  }

  private async vaga(chave: string) {
    const uso = this.emUso.get(chave) ?? 0;
    if (uso < this.o.concorrencia) {
      this.emUso.set(chave, uso + 1);
      return;
    }
    await new Promise<void>((res) => this.filas.set(chave, [...(this.filas.get(chave) ?? []), res]));
    this.emUso.set(chave, (this.emUso.get(chave) ?? 0) + 1);
  }

  private liberar(chave: string) {
    this.emUso.set(chave, (this.emUso.get(chave) ?? 1) - 1);
    const fila = this.filas.get(chave);
    const prox = fila?.shift();
    if (prox) prox();
  }

  private async respeitarJanela(chave: string) {
    for (;;) {
      const agora = this.o.agora();
      const jan = (this.janelas.get(chave) ?? []).filter((t) => agora - t < 60_000);
      if (jan.length < this.o.reqPorMinuto) {
        jan.push(agora);
        this.janelas.set(chave, jan);
        return;
      }
      await this.o.dormir(60_000 - (agora - jan[0]) + 50);
    }
  }

  /** Conta a chamada no dia (fuso de São Paulo, o mesmo do limite diário do Omie) e ajusta o disjuntor. */
  private async contar(resultado: "ok" | "erro" | "neutro", mensagem?: string) {
    const hoje = hojeNoFuso(new Date(this.o.agora()));
    await this.o.estado.atualizar((e) => {
      const chamadas = (e.dia === hoje ? e.chamadas_dia : 0) + 1;
      if (resultado === "ok") return { bloqueado_ate: null, erros_consecutivos: 0, dia: hoje, chamadas_dia: chamadas };
      if (resultado === "neutro") return { ...e, dia: hoje, chamadas_dia: chamadas };
      const erros = e.erros_consecutivos + 1;
      const abrir = erros >= this.o.errosParaAbrir;
      return {
        bloqueado_ate: abrir ? new Date(this.o.agora() + this.o.pausaMin * 60_000) : e.bloqueado_ate,
        erros_consecutivos: abrir ? 0 : erros,
        dia: hoje,
        chamadas_dia: chamadas,
      };
    }, mensagem);
  }

  /**
   * @param opcoes.listagem true em chamadas de listagem/consulta: "não encontrado" vira resposta vazia.
   * Em escrita, "não encontrado" é erro de verdade (ex.: produto inexistente ao incluir OP).
   */
  async chamar<T = unknown>(contrato: Contrato, param: Record<string, unknown>, opcoes: { listagem?: boolean } = {}): Promise<T> {
    const chave = `${contrato.endpoint}|${contrato.call}`;
    const est = await this.o.estado.ler();
    const agora = this.o.agora();
    if (est.bloqueado_ate && est.bloqueado_ate.getTime() > agora) {
      throw new ErroOmie(`Integração pausada até ${est.bloqueado_ate.toISOString()} após erros seguidos`, "circuito");
    }
    const hoje = hojeNoFuso(new Date(agora));
    const chamadasHoje = est.dia === hoje ? est.chamadas_dia : 0;
    if (this.o.limiteDiario > 0 && chamadasHoje >= this.o.limiteDiario) {
      throw new ErroOmie(`Limite diário de ${this.o.limiteDiario} chamadas atingido`, "limite_diario");
    }

    await this.vaga(chave);
    try {
      await this.respeitarJanela(chave);
      let resp: Response;
      try {
        resp = await this.o.fetchFn(this.o.urlBase + contrato.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ call: contrato.call, app_key: this.o.appKey, app_secret: this.o.appSecret, param: [param] }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (e) {
        await this.contar("erro", `rede: ${(e as Error).message}`);
        throw new ErroOmie(`Falha de rede ao chamar ${contrato.call}: ${(e as Error).message}`, "rede");
      }
      const texto = await resp.text();
      let corpo: Record<string, unknown> = {};
      try {
        corpo = texto ? JSON.parse(texto) : {};
      } catch {
        corpo = { faultstring: texto.slice(0, 300) };
      }
      const falha = (corpo.faultstring as string) ?? (!resp.ok ? `HTTP ${resp.status}` : null);
      if (falha) {
        if (/redundante/i.test(falha)) {
          await this.contar("neutro");
          throw new ErroOmie(falha, "redundante", corpo);
        }
        // "não encontrado" em listagem vazia é resposta válida no Omie (só em leitura)
        if (opcoes.listagem && /n[aã]o (foram )?encontrad|n[aã]o existem registros/i.test(falha)) {
          await this.contar("ok");
          return {} as T;
        }
        await this.contar("erro", falha);
        throw new ErroOmie(`${contrato.call}: ${falha}`, "api", corpo);
      }
      await this.contar("ok");
      return corpo as T;
    } finally {
      this.liberar(chave);
    }
  }

  /** Percorre todas as páginas de uma listagem. */
  async *paginar<T>(
    contrato: Contrato,
    montarParam: (pagina: number) => Record<string, unknown>,
    extrair: (resp: Record<string, unknown>) => { registros: T[]; totalPaginas: number },
  ): AsyncGenerator<T> {
    let pagina = 1;
    for (;;) {
      const resp = await this.chamar<Record<string, unknown>>(contrato, montarParam(pagina), { listagem: true });
      const { registros, totalPaginas } = extrair(resp);
      for (const r of registros) yield r;
      if (pagina >= (totalPaginas || 1)) return;
      pagina++;
    }
  }
}
