// Sincronização com o Omie.
// Leitura (Omie → PCP): produtos, estrutura, saldo de estoque, pedidos de venda
// e pedidos de compra. Escrita (PCP → Omie): outbox de OPs e requisições.
//
// Dono de cada dado: o Omie é dono de produto, estrutura, estoque, pedidos e
// compras. O PCP nunca sobrescreve no Omie o que é do Omie; e ao importar,
// nunca sobrescreve a classificação de PCP (tipo, origem, política, lotes).

import { sql, type Sql } from "@/lib/db";
import { agregarItensPedido } from "@/domain/tendencia";
import { formatarOmie, hojeNoFuso, somarDias } from "@/domain/datas";
import { ClienteOmie, ErroOmie, type ArmazemEstado, type EstadoIntegracao } from "./cliente";
import { CONTRATOS, contratoLiberado, type NomeContrato } from "./contratos";
import { lerConfigOmie, type ModoOmie } from "./config";
import {
  extrairListaClientes,
  extrairListaPedidos,
  extrairListaProdutos,
  extrairPedidosCompra,
  extrairPosicaoEstoque,
  mapearClienteResumido,
  mapearEstrutura,
  mapearPedido,
  mapearPedidoCompra,
  mapearProduto,
  mapearSaldo,
  payloadConcluirOP,
  payloadIncluirOP,
  payloadRequisicaoCompra,
} from "./mapeamento";

export type { ModoOmie };
/** Modo atual: variável OMIE_MODO (se definida) ou o escolhido na tela Integrações. */
export const modoOmie = async (): Promise<ModoOmie> => (await lerConfigOmie()).modo;

export const armazemSql = (chave = "omie:api"): ArmazemEstado => ({
  async ler() {
    const [r] = await sql`select bloqueado_ate, erros_consecutivos, dia, chamadas_dia from integracao_estado where entidade = ${chave}`;
    return (r as unknown as EstadoIntegracao) ?? { bloqueado_ate: null, erros_consecutivos: 0, dia: null, chamadas_dia: 0 };
  },
  async atualizar(mudar, mensagem) {
    await sql.begin(async (tx) => {
      await tx`insert into integracao_estado (entidade) values (${chave}) on conflict do nothing`;
      const [atual] = await tx`select bloqueado_ate, erros_consecutivos, dia, chamadas_dia from integracao_estado where entidade = ${chave} for update`;
      const e = mudar(atual as unknown as EstadoIntegracao);
      await tx`update integracao_estado set bloqueado_ate = ${e.bloqueado_ate}, erros_consecutivos = ${e.erros_consecutivos},
                 dia = ${e.dia}, chamadas_dia = ${e.chamadas_dia}, ultima_execucao = now(),
                 mensagem = coalesce(${mensagem ?? null}, mensagem) where entidade = ${chave}`;
    });
  },
});

export async function criarClienteOmie(fetchFn?: typeof fetch): Promise<ClienteOmie> {
  const cfg = await lerConfigOmie();
  return criarClienteCom(cfg.appKey, cfg.appSecret, fetchFn);
}

export function criarClienteCom(appKey: string, appSecret: string, fetchFn?: typeof fetch, chaveEstado = "omie:api"): ClienteOmie {
  return new ClienteOmie({
    appKey,
    appSecret,
    reqPorMinuto: Number(process.env.OMIE_REQ_POR_MINUTO || 200),
    limiteDiario: Number(process.env.OMIE_LIMITE_DIARIO || 0),
    estado: armazemSql(chaveEstado),
    fetchFn,
  });
}

async function log(entidade: string, direcao: "entrada" | "saida", status: string, mensagem: string, referencia?: string, payload?: unknown) {
  await sql`insert into integracao_log (sistema, direcao, entidade, referencia, status, mensagem, payload)
            values ('omie', ${direcao}, ${entidade}, ${referencia ?? null}, ${status}, ${mensagem}, ${payload === undefined ? null : sql.json(payload as never)})`;
}

async function marcar(entidade: string, ok: boolean, mensagem: string) {
  await sql`
    insert into integracao_estado (entidade, ultima_execucao, ultimo_sucesso, mensagem)
    values (${entidade}, now(), ${ok ? new Date() : null}, ${mensagem})
    on conflict (entidade) do update set ultima_execucao = now(),
      ultimo_sucesso = case when ${ok} then now() else integracao_estado.ultimo_sucesso end, mensagem = excluded.mensagem`;
}

// ---------- execução em fatias (hospedagem serverless) ----------
// Na Vercel cada execução tem tempo limitado. As tarefas longas param quando o
// prazo acaba, gravam onde pararam (cursor) e continuam na próxima execução.
export interface Prazo {
  ate: number; // epoch ms; Infinity = sem limite
}
const SEM_PRAZO: Prazo = { ate: Infinity };
const esgotado = (p: Prazo, folgaMs = 0) => Date.now() + folgaMs >= p.ate;

/** Sinaliza que a tarefa avançou, mas ainda não terminou (continua na próxima execução). */
export class SincronizacaoParcial extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "SincronizacaoParcial";
  }
}

async function lerCursor<T>(ent: string): Promise<T | null> {
  const [r] = await sql`select mensagem from integracao_estado where entidade = ${`cursor:${ent}`}`;
  if (!r?.mensagem) return null;
  try {
    return JSON.parse(r.mensagem as string) as T;
  } catch {
    return null;
  }
}
async function salvarCursor(ent: string, valor: unknown) {
  const texto = valor === null ? null : JSON.stringify(valor);
  await sql`insert into integracao_estado (entidade, mensagem, ultima_execucao) values (${`cursor:${ent}`}, ${texto}, now())
            on conflict (entidade) do update set mensagem = excluded.mensagem, ultima_execucao = now()`;
}

/** Percorre as páginas a partir de `inicio`; para quando o prazo acaba. */
async function* paginasDesde(
  c: ClienteOmie,
  contrato: (typeof CONTRATOS)[NomeContrato],
  montar: (pagina: number) => Record<string, unknown>,
  extrair: (r: Record<string, unknown>) => { registros: Record<string, unknown>[]; totalPaginas: number },
  inicio: number,
) {
  let pagina = inicio;
  for (;;) {
    const resp = await c.chamar<Record<string, unknown>>(contrato, montar(pagina), { listagem: true });
    const { registros, totalPaginas } = extrair(resp);
    const ultima = pagina >= (totalPaginas || 1);
    yield { pagina, totalPaginas: totalPaginas || 1, registros, ultima };
    if (ultima) return;
    pagina++;
  }
}

// ---------- classificação de item novo vindo do Omie ----------
export function classificarNovo(p: { codigo: string; descricao: string; tipoItem?: string }) {
  const d = p.descricao.toUpperCase();
  const t = p.tipoItem ?? "";
  if (t === "04") return { tipo: "produto", origem: "fabricado" } as const;
  if (/^(CJ|UN|CONJ)\b/.test(d) || t === "03" || t === "06") return { tipo: /^(CJ|UN|CONJ)\b/.test(d) ? "conjunto" : "peca", origem: "fabricado" } as const;
  if (t === "01" || t === "02") return { tipo: "materia_prima", origem: "comprado" } as const;
  return { tipo: "componente_comprado", origem: "comprado" } as const;
}

// ---------- leitura incremental (produtos e pedidos) ----------
// Uma varredura completa a cada 24 h; entre uma e outra, só o que mudou nos
// últimos 2 dias (filtrar_por_data_de/ate). O modo fica em integracao_estado
// (entidade "cursor:modo:<entidade>"), sem migração de banco.
// OMIE_INCREMENTAL=0 desliga o modo incremental (sempre leitura completa).
export interface FiltroData {
  de: string; // dd/mm/aaaa
  ate: string; // dd/mm/aaaa
}
interface ModoLeitura {
  ultimaCompleta: string | null; // ISO
  desligado?: boolean; // o Omie recusou o filtro: só leitura completa
  motivo?: string;
}
const COMPLETA_A_CADA_MS = 24 * 60 * 60_000;
const DIAS_INCREMENTAL = 2;

async function escolherFiltro(ent: string): Promise<FiltroData | null> {
  if (process.env.OMIE_INCREMENTAL === "0") return null;
  const m = await lerCursor<ModoLeitura>(`modo:${ent}`);
  if (!m?.ultimaCompleta || m.desligado) return null;
  if (Date.now() - new Date(m.ultimaCompleta).getTime() >= COMPLETA_A_CADA_MS) return null;
  const hoje = hojeNoFuso();
  return { de: formatarOmie(somarDias(hoje, -DIAS_INCREMENTAL)), ate: formatarOmie(hoje) };
}

async function concluirLeitura(ent: string, filtro: FiltroData | null) {
  if (filtro) return; // só a leitura completa reinicia a contagem das 24 h
  const m = await lerCursor<ModoLeitura>(`modo:${ent}`);
  await salvarCursor(`modo:${ent}`, { ...m, ultimaCompleta: new Date().toISOString() });
}

/** Erro de API que indica que o Omie não aceita a tag/parâmetro do filtro. */
const filtroRecusado = (e: unknown) =>
  e instanceof ErroOmie && e.tipo === "api" && /\btag\b|par[aâ]metro|filtrar_por_data/i.test(e.message);

const paramFiltro = (f: FiltroData | null | undefined) => (f ? { filtrar_por_data_de: f.de, filtrar_por_data_ate: f.ate } : {});
const prefixoFiltro = (f: FiltroData | null) => (f ? `alterados desde ${f.de}: ` : "");

/**
 * Executa a leitura no modo certo (completa ou incremental). O filtro vai no
 * cursor, para a retomada entre execuções usar o mesmo filtro. Se o Omie
 * recusar o filtro, desliga o incremental da entidade e refaz a leitura completa
 * na mesma execução.
 */
async function lerComModo<C extends { pagina: number; filtro?: FiltroData | null }>(
  ent: string,
  inicial: Omit<C, "filtro">,
  ler: (cur: C) => Promise<string>,
): Promise<string> {
  const salvo = await lerCursor<C>(ent);
  // cursor antigo (sem "filtro") continua como leitura completa
  const cur = (salvo ? { ...salvo, filtro: salvo.filtro ?? null } : { ...inicial, filtro: await escolherFiltro(ent) }) as C;
  const filtro = cur.filtro ?? null;
  try {
    const msg = await ler(cur);
    await concluirLeitura(ent, filtro);
    return prefixoFiltro(filtro) + msg;
  } catch (e) {
    if (!filtro || !filtroRecusado(e)) throw e;
    const motivo = (e as Error).message;
    const m = await lerCursor<ModoLeitura>(`modo:${ent}`);
    await salvarCursor(`modo:${ent}`, { ultimaCompleta: m?.ultimaCompleta ?? null, desligado: true, motivo });
    await log(ent, "entrada", "erro", `O Omie recusou o filtro por data; leitura incremental desligada (${ent}): ${motivo}`);
    await salvarCursor(ent, null);
    const msg = await ler({ ...inicial, filtro: null } as C);
    await concluirLeitura(ent, null);
    return msg;
  }
}

// ---------- leituras ----------
type CursorProdutos = { pagina: number; novos: number; atualizados: number; filtro?: FiltroData | null };

export async function sincronizarProdutos(c: ClienteOmie, prazo: Prazo = SEM_PRAZO) {
  return lerComModo<CursorProdutos>("produtos", { pagina: 1, novos: 0, atualizados: 0 }, (cur) => lerProdutos(c, prazo, cur));
}

async function lerProdutos(c: ClienteOmie, prazo: Prazo, cur: CursorProdutos) {
  let { novos, atualizados } = cur;
  for await (const pg of paginasDesde(
    c,
    CONTRATOS.listarProdutos,
    (pagina) => ({ pagina, registros_por_pagina: 100, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N", ...paramFiltro(cur.filtro) }),
    extrairListaProdutos,
    cur.pagina,
  )) {
    const porCodigo = new Map<string, Record<string, unknown>>();
    for (const bruto of pg.registros) {
      const p = mapearProduto(bruto);
      if (!p) continue;
      const cls = classificarNovo({ ...p, tipoItem: (bruto as Record<string, string>).tipoItem });
      porCodigo.set(p.codigo, { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, tipo: cls.tipo, origem: cls.origem, omie_id: p.omie_id, revisar: true, ativo: !p.inativo });
    }
    const linhas = [...porCodigo.values()];
    if (linhas.length) {
      // um único comando por página (antes: um insert por produto)
      const r = await sql`
        insert into itens ${sql(linhas as never, "codigo", "descricao", "unidade", "tipo", "origem", "omie_id", "revisar", "ativo")}
        on conflict (codigo) do update set descricao = excluded.descricao, unidade = excluded.unidade,
          omie_id = excluded.omie_id, ativo = excluded.ativo, updated_at = now()
        returning (xmax = 0) as inserido`;
      for (const x of r) x.inserido ? novos++ : atualizados++;
    }
    if (pg.ultima) break;
    if (esgotado(prazo)) {
      await salvarCursor("produtos", { pagina: pg.pagina + 1, novos, atualizados, filtro: cur.filtro ?? null });
      throw new SincronizacaoParcial(`${prefixoFiltro(cur.filtro ?? null)}em andamento: página ${pg.pagina} de ${pg.totalPaginas} (continua na próxima execução)`);
    }
  }
  await salvarCursor("produtos", null);
  return `${novos} novos, ${atualizados} atualizados`;
}

// ---------- estruturas ----------
// Uma chamada ConsultarEstrutura por item fabricado (centenas de chamadas), então
// anda em fatias. Ordem: primeiro o que está na carteira (pedidos de venda abertos
// e OPs ativas), descendo pela estrutura já conhecida (acabado → conjunto → peça);
// depois o restante. Duas leituras em paralelo (o cliente limita a 2 por método).
const STATUS_OP_ATIVOS = ["sugerida", "firmada", "liberada", "em_processo"];
const LEITURAS_PARALELAS = 2;

interface CursorEstrutura {
  feitos: number[]; // ids dos itens já lidos neste ciclo
  linhas: number;
  avisos: number;
}
interface PaiEstrutura {
  id: number;
  codigo: string;
  omie_id: number;
  carteira: boolean;
}

/** Itens fabricados ainda não lidos no ciclo, na ordem de prioridade. */
async function filaEstrutura(excluir: number[]): Promise<PaiEstrutura[]> {
  const rows = await sql<{ id: number; codigo: string; omie_id: string | number; nivel: number | null }[]>`
    with recursive raiz as (
      select pi.item_id as id from pedido_itens pi join pedidos_venda pv on pv.id = pi.pedido_id where pv.status = 'aberto'
      union
      select o.item_id from ordens_producao o where o.status::text = any(${STATUS_OP_ATIVOS}::text[])
    ), arvore(id, nivel) as (
      select id, 0 from raiz
      union
      select e.filho_id, a.nivel + 1 from estrutura e join arvore a on a.id = e.pai_id where a.nivel < 20
    ), prioridade as (
      select id, min(nivel) as nivel from arvore group by id
    )
    select i.id, i.codigo, i.omie_id, p.nivel
    from itens i left join prioridade p on p.id = i.id
    where i.ativo and i.origem = 'fabricado' and i.omie_id is not null and not (i.id = any(${excluir}::int[]))
    order by p.nivel is null, p.nivel, i.id`;
  return rows.map((r) => ({ id: r.id, codigo: r.codigo, omie_id: Number(r.omie_id), carteira: r.nivel !== null }));
}

export async function sincronizarEstrutura(c: ClienteOmie, prazo: Prazo = SEM_PRAZO) {
  const salvo = await lerCursor<Partial<CursorEstrutura> & { depoisDe?: number }>("estrutura");
  // cursor antigo ({ depoisDe }) ou inválido: começa um ciclo novo
  const cur: CursorEstrutura =
    salvo && Array.isArray(salvo.feitos) ? { feitos: salvo.feitos, linhas: salvo.linhas ?? 0, avisos: salvo.avisos ?? 0 } : { feitos: [], linhas: 0, avisos: 0 };
  const feitos = new Set(cur.feitos);
  const emAndamento = new Set<number>();
  const porOmie = new Map((await sql<{ id: number; omie_id: number }[]>`select id, omie_id from itens where omie_id is not null`).map((r) => [Number(r.omie_id), r.id]));
  let fila = await filaEstrutura([...feitos]);
  let foraDaCarteira = new Set(fila.filter((p) => !p.carteira).map((p) => p.id));
  let linhas = 0;
  const avisos: string[] = [];
  let iniciadas = 0;
  let parar = false;
  let erro: unknown = null;

  const proximo = () => {
    while (fila.length) {
      const p = fila.shift()!;
      if (!feitos.has(p.id) && !emAndamento.has(p.id)) return p;
    }
    return null;
  };

  const ler = async (pai: PaiEstrutura) => {
    const resp = await c.chamar<Record<string, unknown>>(CONTRATOS.consultarEstrutura, { idProduto: pai.omie_id }, { listagem: true });
    const est = mapearEstrutura(resp);
    const filhos: number[] = [];
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`delete from estrutura where pai_id = ${pai.id} and fonte = 'omie'`;
      const porFilho = new Map<number, { pai_id: number; filho_id: number; quantidade: number; perda_pct: number; fonte: string }>();
      for (const l of est) {
        const filho = porOmie.get(l.filho_omie_id);
        if (!filho) {
          avisos.push(`${pai.codigo}: componente Omie ${l.filho_codigo || l.filho_omie_id} não importado`);
          continue;
        }
        porFilho.set(filho, { pai_id: pai.id, filho_id: filho, quantidade: l.quantidade, perda_pct: l.perda_pct, fonte: "omie" });
      }
      const ls = [...porFilho.values()];
      if (ls.length) {
        await t`insert into estrutura ${t(ls as never, "pai_id", "filho_id", "quantidade", "perda_pct", "fonte")}
                on conflict (pai_id, filho_id) do update set quantidade = excluded.quantidade, perda_pct = excluded.perda_pct,
                  fonte = 'omie', updated_at = now()`;
        linhas += ls.length;
        filhos.push(...porFilho.keys());
      }
    });
    return filhos;
  };

  const trabalhador = async () => {
    for (;;) {
      if (parar || erro) return;
      if (iniciadas > 0 && esgotado(prazo, 3000)) {
        parar = true;
        return;
      }
      const pai = proximo();
      if (!pai) return;
      iniciadas++;
      emAndamento.add(pai.id);
      try {
        const filhos = await ler(pai);
        feitos.add(pai.id);
        // item da carteira revelou filhos que estavam no fim da fila: recalcula a prioridade
        if (pai.carteira && filhos.some((f) => foraDaCarteira.has(f))) {
          fila = await filaEstrutura([...feitos, ...emAndamento]);
          foraDaCarteira = new Set(fila.filter((p) => !p.carteira).map((p) => p.id));
        }
      } catch (e) {
        erro ??= e;
      } finally {
        emAndamento.delete(pai.id);
      }
    }
  };

  await Promise.all(Array.from({ length: LEITURAS_PARALELAS }, trabalhador));
  const progresso: CursorEstrutura = { feitos: [...feitos], linhas: cur.linhas + linhas, avisos: cur.avisos + avisos.length };
  if (erro) {
    // não perde o que já foi lido nesta execução
    await salvarCursor("estrutura", progresso);
    throw erro;
  }
  const faltam = fila.filter((p) => !feitos.has(p.id)).length;
  if (faltam > 0) {
    await salvarCursor("estrutura", progresso);
    throw new SincronizacaoParcial(`em andamento: ${feitos.size} estruturas lidas, faltam ${faltam} (continua na próxima execução)`);
  }
  await salvarCursor("estrutura", null);
  const totAvisos = progresso.avisos;
  return `${feitos.size} estruturas lidas, ${progresso.linhas} linhas${totAvisos ? `; ${totAvisos} avisos${avisos.length ? `: ${avisos.slice(0, 5).join("; ")}` : ""}` : ""}`;
}

export async function sincronizarEstoque(c: ClienteOmie, prazo: Prazo = SEM_PRAZO) {
  const local = process.env.OMIE_LOCAL_ESTOQUE ? Number(process.env.OMIE_LOCAL_ESTOQUE) : undefined;
  const hoje = hojeNoFuso().split("-").reverse().join("/");
  // a leitura pode levar mais de uma execução: o que já foi lido fica no cursor (mesmo dia)
  const salvo = await lerCursor<{ dia: string; pagina: number; saldos: [number, number][] }>("estoque");
  const cur = salvo && salvo.dia === hoje ? salvo : { dia: hoje, pagina: 1, saldos: [] as [number, number][] };
  const saldos: { omie_id: number; saldo: number }[] = cur.saldos.map(([omie_id, saldo]) => ({ omie_id, saldo }));
  for await (const pg of paginasDesde(
    c,
    CONTRATOS.listarPosicaoEstoque,
    (nPagina) => ({ nPagina, nRegPorPagina: 100, dDataPosicao: hoje, cExibeTodos: "N", ...(local ? { codigo_local_estoque: local } : {}) }),
    extrairPosicaoEstoque as never,
    cur.pagina,
  )) {
    for (const b of pg.registros) {
      const s = mapearSaldo(b as never);
      if (s) saldos.push(s);
    }
    if (pg.ultima) break;
    if (esgotado(prazo)) {
      await salvarCursor("estoque", { dia: hoje, pagina: pg.pagina + 1, saldos: saldos.map((s) => [s.omie_id, s.saldo]) });
      throw new SincronizacaoParcial(`em andamento: página ${pg.pagina} de ${pg.totalPaginas} (continua na próxima execução)`);
    }
  }
  // só grava depois de ler todas as páginas: nunca deixa o estoque pela metade
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`update estoque_saldos set quantidade = 0, atualizado_em = now() where fonte = 'omie'`;
    // um comando só para todos os saldos (antes: um insert por item)
    const ultimo = new Map(saldos.map((s) => [s.omie_id, s.saldo]));
    if (ultimo.size) {
      await t`insert into estoque_saldos (item_id, quantidade, fonte, atualizado_em)
              select i.id, x.saldo, 'omie', now()
              from unnest(${[...ultimo.keys()]}::bigint[], ${[...ultimo.values()]}::numeric[]) as x(omie_id, saldo)
              join itens i on i.omie_id = x.omie_id
              on conflict (item_id) do update set quantidade = excluded.quantidade, fonte = 'omie', atualizado_em = now()`;
    }
  });
  await salvarCursor("estoque", null);
  return `${saldos.length} saldos`;
}

type CursorPedidos = { pagina: number; n: number; filtro?: FiltroData | null };

export async function sincronizarPedidos(c: ClienteOmie, prazo: Prazo = SEM_PRAZO) {
  return lerComModo<CursorPedidos>("pedidos", { pagina: 1, n: 0 }, (cur) => lerPedidos(c, prazo, cur));
}

async function lerPedidos(c: ClienteOmie, prazo: Prazo, cur: CursorPedidos) {
  const faturado = (process.env.OMIE_ETAPAS_FATURADO ?? "60,70,80").split(",").map((s) => s.trim());
  const nomes = (await lerCursor<Record<string, string>>("clientes:nomes")) ?? {};
  let n = cur.n;
  for await (const pg of paginasDesde(
    c,
    CONTRATOS.listarPedidosVenda,
    (pagina) => ({ pagina, registros_por_pagina: 100, apenas_importado_api: "N", ...paramFiltro(cur.filtro) }),
    extrairListaPedidos,
    cur.pagina,
  )) {
    // grava a página inteira em poucos comandos (antes: ~6 idas ao banco por pedido,
    // o que estourava o limite de 60 s da Vercel)
    const porOmie = new Map<number, NonNullable<ReturnType<typeof mapearPedido>>>();
    for (const b of pg.registros) {
      const p = mapearPedido(b, nomes);
      if (p && p.data_entrega) porOmie.set(p.omie_id, p);
    }
    const peds = [...porOmie.values()];
    if (peds.length) {
      await sql.begin(async (tx) => {
        const t = tx as unknown as Sql;
        const numeros = peds.map((p) => p.numero);
        const omieIds = peds.map((p) => p.omie_id);
        // pedido digitado à mão no PCP com o mesmo número: passa a ser o pedido do Omie
        await t`update pedidos_venda pv set omie_id = x.omie_id, updated_at = now()
                from (select distinct on (numero) numero, omie_id from unnest(${numeros}::text[], ${omieIds}::bigint[]) as u(numero, omie_id)
                      where not exists (select 1 from pedidos_venda q where q.omie_id = u.omie_id)) x
                where pv.numero = x.numero and pv.omie_id is null`;
        // número repetido em outro pedido do Omie: grava com o código do Omie para não colidir
        const dono = new Map<string, number | null>(
          (await t`select numero, omie_id from pedidos_venda where numero = any(${numeros}::text[])`).map((r) => [r.numero as string, r.omie_id === null ? null : Number(r.omie_id)]),
        );
        const linhas = peds.map((p) => {
          const d = dono.get(p.numero);
          const numero = d !== undefined && d !== p.omie_id ? `${p.numero} (Omie ${p.omie_id})` : p.numero;
          if (d === undefined) dono.set(p.numero, p.omie_id);
          const status = p.cancelado ? "cancelado" : faturado.includes(p.etapa) ? "atendido" : "aberto";
          return { numero, cliente: p.cliente, data_emissao: p.data_emissao ?? p.data_entrega, data_entrega: p.data_entrega, status, omie_id: p.omie_id };
        });
        const ids = await t`
          insert into pedidos_venda ${t(linhas as never, "numero", "cliente", "data_emissao", "data_entrega", "status", "omie_id")}
          on conflict (omie_id) do update set cliente = excluded.cliente, data_entrega = excluded.data_entrega,
            status = excluded.status, updated_at = now()
          returning id, omie_id`;
        const idPorOmie = new Map(ids.map((r) => [Number(r.omie_id), r.id as number]));
        const pedIds: number[] = [], prodIds: number[] = [], qtds: number[] = [];
        for (const p of peds) {
          for (const i of agregarItensPedido(p.itens)) {
            pedIds.push(idPorOmie.get(p.omie_id)!);
            prodIds.push(i.produto_omie_id);
            qtds.push(i.quantidade);
          }
        }
        if (pedIds.length) {
          await t`insert into pedido_itens (pedido_id, item_id, quantidade)
                  select x.pedido_id, it.id, x.qtd
                  from unnest(${pedIds}::int[], ${prodIds}::bigint[], ${qtds}::numeric[]) as x(pedido_id, produto_omie_id, qtd)
                  join itens it on it.omie_id = x.produto_omie_id
                  on conflict (pedido_id, item_id) do update set quantidade = excluded.quantidade`;
        }
      });
      n += peds.length;
    }
    if (pg.ultima) break;
    if (esgotado(prazo)) {
      await salvarCursor("pedidos", { pagina: pg.pagina + 1, n, filtro: cur.filtro ?? null });
      throw new SincronizacaoParcial(`${prefixoFiltro(cur.filtro ?? null)}em andamento: página ${pg.pagina} de ${pg.totalPaginas} (continua na próxima execução)`);
    }
  }
  await salvarCursor("pedidos", null);
  return `${n} pedidos`;
}

/**
 * Nomes dos clientes (ListarClientesResumido), 1 vez ao dia, em fatias. Guarda o
 * mapa código → nome em integracao_estado ("cursor:clientes:nomes"), sem migração,
 * e troca "Cliente Omie <código>" pelo nome nos pedidos já gravados.
 */
export async function sincronizarClientes(c: ClienteOmie, prazo: Prazo = SEM_PRAZO) {
  const cur = (await lerCursor<{ pagina: number; nomes: Record<string, string> }>("clientes")) ?? { pagina: 1, nomes: {} };
  const nomes: Record<string, string> = { ...cur.nomes };
  for await (const pg of paginasDesde(
    c,
    CONTRATOS.listarClientesResumido,
    (pagina) => ({ pagina, registros_por_pagina: 100, apenas_importado_api: "N" }),
    extrairListaClientes,
    cur.pagina,
  )) {
    for (const b of pg.registros) {
      const cl = mapearClienteResumido(b);
      if (cl) nomes[cl.codigo] = cl.nome;
    }
    if (pg.ultima) break;
    if (esgotado(prazo)) {
      await salvarCursor("clientes", { pagina: pg.pagina + 1, nomes });
      throw new SincronizacaoParcial(`em andamento: página ${pg.pagina} de ${pg.totalPaginas} (continua na próxima execução)`);
    }
  }
  const codigos = Object.keys(nomes);
  let trocados = 0;
  // se o Omie não devolveu nada, mantém o mapa anterior
  if (codigos.length) {
    await salvarCursor("clientes:nomes", nomes);
    const r = await sql`
      update pedidos_venda pv set cliente = x.nome, updated_at = now()
      from unnest(${codigos}::text[], ${codigos.map((k) => nomes[k])}::text[]) as x(codigo, nome)
      where pv.cliente = 'Cliente Omie ' || x.codigo`;
    trocados = r.count;
  }
  await salvarCursor("clientes", null);
  return `${codigos.length} clientes${trocados ? `; ${trocados} pedidos com o nome do cliente` : ""}`;
}

export async function sincronizarCompras(c: ClienteOmie) {
  const recs: ReturnType<typeof mapearPedidoCompra> = [];
  for await (const b of c.paginar(
    CONTRATOS.pesquisarPedidosCompra,
    (nPagina) => ({ nPagina, nRegsPorPagina: 50, lExibirPedidosPendentes: true, lExibirPedidosFaturados: false }),
    extrairPedidosCompra,
  )) recs.push(...mapearPedidoCompra(b));
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`update recebimentos_programados set status = 'recebido' where omie_ref is not null and status = 'aberto'`;
    // um comando só (antes: um insert por item de compra)
    const unicos = [...new Map(recs.map((r) => [r.referencia, r])).values()];
    if (unicos.length) {
      await t`insert into recebimentos_programados (item_id, quantidade, data_prevista, documento, status, omie_ref)
              select it.id, x.qtd, x.data_prevista::date, x.documento, 'aberto', x.ref
              from unnest(${unicos.map((r) => r.produto_omie_id)}::bigint[], ${unicos.map((r) => r.quantidade_pendente)}::numeric[],
                          ${unicos.map((r) => r.data_prevista ?? hojeNoFuso())}::text[], ${unicos.map((r) => r.documento)}::text[],
                          ${unicos.map((r) => r.referencia)}::text[]) as x(produto_omie_id, qtd, data_prevista, documento, ref)
              join itens it on it.omie_id = x.produto_omie_id
              on conflict (omie_ref) do update set quantidade = excluded.quantidade, data_prevista = excluded.data_prevista, status = 'aberto'`;
    }
  });
  return `${recs.length} itens de compra em aberto`;
}

// ---------- escrita (outbox) ----------
interface ItemOutbox {
  id: number;
  tipo: string;
  referencia: string;
  payload: Record<string, unknown>;
  tentativas: number;
}

/** Monta a chamada que seria feita ao Omie para um item da fila. */
export async function montarChamada(o: ItemOutbox): Promise<{ contrato: NomeContrato; param: Record<string, unknown> } | { erro: string }> {
  if (o.tipo === "incluir_op" || o.tipo === "concluir_op" || o.tipo === "cancelar_op") {
    const [op] = await sql`
      select o.numero, o.quantidade, o.data_necessidade, o.qtd_boa, o.omie_id,
        to_char(o.concluida_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as concluida_em, i.omie_id as produto_omie_id, i.codigo
      from ordens_producao o join itens i on i.id = o.item_id where o.id = ${o.payload.op_id as number}`;
    if (!op) return { erro: "OP não existe mais" };
    if (o.tipo === "incluir_op") {
      if (!op.produto_omie_id) return { erro: `Produto ${op.codigo} sem vínculo com o Omie (omie_id vazio)` };
      return { contrato: "incluirOP", param: payloadIncluirOP(op as never) };
    }
    if (o.tipo === "concluir_op") return { contrato: "concluirOP", param: payloadConcluirOP(op as never) };
    return { contrato: "excluirOP", param: { cCodIntOP: `PCP-${op.numero}`, nCodOP: op.omie_id ?? undefined } };
  }
  if (o.tipo === "requisicao_compra") {
    const itens = o.payload.itens as { item_id: number; quantidade: number }[];
    const ids = itens.map((i) => i.item_id);
    const omie = new Map((await sql`select id, omie_id, codigo from itens where id = any(${ids})`).map((r) => [r.id as number, r]));
    const semVinculo = ids.filter((i) => !omie.get(i)?.omie_id).map((i) => omie.get(i)?.codigo ?? i);
    if (semVinculo.length) return { erro: `Itens sem vínculo com o Omie: ${semVinculo.join(", ")}` };
    return {
      contrato: "incluirRequisicaoCompra",
      param: payloadRequisicaoCompra({
        referencia: o.referencia,
        data: o.payload.data as string,
        itens: itens.map((i) => ({ produto_omie_id: omie.get(i.item_id)!.omie_id as number, quantidade: i.quantidade })),
      }),
    };
  }
  return { erro: `Tipo desconhecido: ${o.tipo}` };
}

export async function processarOutbox(c: ClienteOmie, limite = 20) {
  const { validados } = await lerConfigOmie();
  const itens = await sql<ItemOutbox[]>`
    select id, tipo, referencia, payload, tentativas from outbox
    where sistema = 'omie' and status = 'pendente' and proxima_tentativa <= now()
    order by id limit ${limite}`;
  let enviados = 0,
    falhas = 0;
  for (const o of itens) {
    // conclusão/cancelamento só depois de a inclusão ter ido
    if (o.tipo !== "incluir_op" && o.tipo !== "requisicao_compra") {
      const [inc] = await sql`select status from outbox where sistema = 'omie' and tipo = 'incluir_op' and referencia = ${o.referencia}`;
      if (inc && inc.status !== "enviado") continue;
    }
    const ch = await montarChamada(o);
    if ("erro" in ch) {
      await falhar(o, ch.erro, true);
      falhas++;
      continue;
    }
    if (!contratoLiberado(ch.contrato, validados)) {
      await sql`update outbox set ultimo_erro = ${`Aguardando validação do método ${CONTRATOS[ch.contrato].call} (marque como validado na tela Integrações)`},
                updated_at = now() where id = ${o.id}`;
      continue;
    }
    try {
      const resp = await c.chamar<Record<string, unknown>>(CONTRATOS[ch.contrato], ch.param);
      await sql`update outbox set status = 'enviado', resposta = ${sql.json(resp as never)}, tentativas = tentativas + 1,
                ultimo_erro = null, updated_at = now() where id = ${o.id}`;
      if (o.tipo === "incluir_op") {
        const nCodOP = Number((resp as Record<string, unknown>).nCodOP ?? 0) || null;
        if (nCodOP) await sql`update ordens_producao set omie_id = ${nCodOP} where id = ${o.payload.op_id as number}`;
      }
      await log(o.tipo, "saida", "ok", "enviado", o.referencia, ch.param);
      enviados++;
    } catch (e) {
      const err = e as ErroOmie;
      if (err.tipo === "circuito" || err.tipo === "limite_diario") break;
      await falhar(o, err.message, false);
      falhas++;
    }
  }
  return `${enviados} enviados, ${falhas} com erro`;
}

async function falhar(o: ItemOutbox, msg: string, definitivo: boolean) {
  const tent = o.tentativas + 1;
  const esperaMin = Math.min(240, 2 ** tent);
  const status = definitivo || tent >= 8 ? "erro" : "pendente";
  // nunca rebaixa um envio que já foi confirmado
  await sql`update outbox set tentativas = ${tent}, ultimo_erro = ${msg}, status = ${status},
            proxima_tentativa = now() + ${`${esperaMin} minutes`}::interval, updated_at = now() where id = ${o.id} and status <> 'enviado'`;
  await log(o.tipo, "saida", "erro", msg, o.referencia);
}

// ---------- orquestração ----------
const INTERVALOS_MIN: Record<string, number> = {
  clientes: 24 * 60, // antes de produtos e pedidos: os pedidos já entram com o nome do cliente
  produtos: 60, // completa 1x/dia; entre elas, só os alterados
  estoque: 10,
  pedidos: 10, // completa 1x/dia; entre elas, só os alterados
  compras: 30,
  outbox: 0,
  estrutura: 24 * 60, // por último: é a mais longa e anda em fatias
};

const TAREFAS: Record<string, (c: ClienteOmie, prazo: Prazo) => Promise<string>> = {
  clientes: sincronizarClientes,
  produtos: sincronizarProdutos,
  estoque: sincronizarEstoque,
  pedidos: sincronizarPedidos,
  compras: (c) => sincronizarCompras(c),
  outbox: (c) => processarOutbox(c),
  estrutura: sincronizarEstrutura,
};

/** Tempo de trabalho por execução. A rota tem maxDuration = 60 s (limite do plano Hobby da Vercel). */
const ORCAMENTO_MS = Number(process.env.OMIE_ORCAMENTO_MS || 45_000);
/** Trava de uma sincronização por vez. Expira sozinha se a função for encerrada no meio. */
const TRAVA_SEG = 120;

export async function executarSincronizacao(opcoes: { forcar?: string[]; cliente?: ClienteOmie; orcamentoMs?: number } = {}) {
  const modo = await modoOmie();
  if (modo !== "ativo") return [{ entidade: "omie", ok: false, mensagem: `Integração em modo "${modo}": nada foi chamado` }];
  // trava por linha no banco (e não pg_advisory_lock de sessão, que fica presa
  // quando o banco usa pooler, como Neon/Supabase na Vercel)
  await sql`insert into integracao_estado (entidade) values ('trava:omie') on conflict do nothing`;
  const [pegou] = await sql`
    update integracao_estado set bloqueado_ate = now() + ${`${TRAVA_SEG} seconds`}::interval
    where entidade = 'trava:omie' and (bloqueado_ate is null or bloqueado_ate < now()) returning 1`;
  if (!pegou) return [{ entidade: "omie", ok: false, mensagem: "Já existe uma sincronização em andamento" }];
  try {
    return await sincronizarSemTrava(opcoes);
  } finally {
    await sql`update integracao_estado set bloqueado_ate = null where entidade = 'trava:omie'`;
  }
}

async function sincronizarSemTrava(opcoes: { forcar?: string[]; cliente?: ClienteOmie; orcamentoMs?: number }) {
  const prazo: Prazo = { ate: Date.now() + (opcoes.orcamentoMs ?? ORCAMENTO_MS) };
  const c = opcoes.cliente ?? (await criarClienteOmie());
  const estados = new Map(
    (await sql`select entidade, ultimo_sucesso from integracao_estado where entidade like 'omie:%'`).map((r) => [r.entidade as string, r.ultimo_sucesso as Date | null]),
  );
  const resultado: { entidade: string; ok: boolean; mensagem: string }[] = [];
  for (const [ent, fn] of Object.entries(TAREFAS)) {
    const ultimo = estados.get(`omie:${ent}`);
    const vencido = !ultimo || Date.now() - new Date(ultimo).getTime() >= INTERVALOS_MIN[ent] * 60_000;
    if (!(opcoes.forcar?.includes(ent) || (!opcoes.forcar && vencido))) continue;
    if (esgotado(prazo, 8000)) {
      resultado.push({ entidade: ent, ok: false, mensagem: "sem tempo nesta execução; fica para a próxima" });
      continue;
    }
    try {
      const msg = await fn(c, prazo);
      await marcar(`omie:${ent}`, true, msg);
      if (ent !== "outbox") await log(ent, "entrada", "ok", msg);
      resultado.push({ entidade: ent, ok: true, mensagem: msg });
    } catch (e) {
      const msg = (e as Error).message;
      if (e instanceof SincronizacaoParcial) {
        // avançou, mas não terminou: não conta como erro e não atualiza o último sucesso
        await marcar(`omie:${ent}`, false, msg);
        resultado.push({ entidade: ent, ok: true, mensagem: msg });
        continue;
      }
      await marcar(`omie:${ent}`, false, msg);
      await log(ent, ent === "outbox" ? "saida" : "entrada", "erro", msg);
      resultado.push({ entidade: ent, ok: false, mensagem: msg });
      if ((e as ErroOmie).tipo === "circuito" || (e as ErroOmie).tipo === "limite_diario") break;
    }
  }
  return resultado;
}

// ---------- teste de conexão ----------
/**
 * Faz uma única leitura leve (1 produto) com as credenciais informadas.
 * Usa um disjuntor separado ("omie:teste") para que credenciais erradas
 * digitadas na tela não pausem a sincronização normal.
 */
export async function testarConexao(appKey: string, appSecret: string, fetchFn?: typeof fetch): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const c = criarClienteCom(appKey, appSecret, fetchFn, "omie:teste");
    const r = await c.chamar<Record<string, unknown>>(
      CONTRATOS.listarProdutos,
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" },
      { listagem: true },
    );
    const total = Number(r.total_de_registros ?? 0);
    await sql`update integracao_estado set bloqueado_ate = null, erros_consecutivos = 0 where entidade = 'omie:teste'`;
    return { ok: true, mensagem: `Conexão OK: o Omie respondeu (${total} produtos cadastrados)` };
  } catch (e) {
    await sql`update integracao_estado set bloqueado_ate = null where entidade = 'omie:teste'`;
    return { ok: false, mensagem: `O Omie recusou a conexão: ${(e as Error).message}` };
  }
}
