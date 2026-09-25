// Programação da produção.
//
// 1) programarFinito: programação para frente com capacidade finita. Cada setor
//    tem N "raias" (recursos: pessoas/postos). As tarefas entram em ordem de
//    prioridade respeitando as dependências (a peça é cortada antes de soldada,
//    o conjunto só começa quando as peças terminam). Resultado: início e fim
//    previstos de cada tarefa e a data prevista de término de cada OP.
//
// 2) cargaNecessaria: programação para trás com capacidade infinita. Mostra
//    QUANDO cada setor precisa trabalhar para cumprir as datas prometidas.
//    Comparada com a capacidade, revela as semanas sobrecarregadas.
//
// O tempo é tratado em "dias fracionários" a partir de hoje (0 = início do
// turno de hoje; 1,5 = metade do turno de amanhã), o que permite comparar
// pontos entre setores com jornadas diferentes.

import type { Calendario } from "./calendario";
import { capacidadeSemana } from "./calendario";
import { diaSemana, diferencaDias, segundaDaSemana, somarDias } from "./datas";
import { arred, type SetorCapacidade } from "./tipos";

export interface TarefaProg {
  id: number;
  op_id: number;
  setor_id: number;
  tempo_restante_min: number;
  status: "pendente" | "em_processo" | "pausada" | "concluida";
  deps: number[];
  fila_manual: number | null;
  op_prioridade: number;
  op_data_necessidade: string;
  /** OP já liberada para a fábrica; OP só firmada entra depois (ainda não pode ser executada) */
  op_liberada?: boolean;
  nivel: number;
  sequencia: number;
}

export interface ResultadoTarefa {
  inicio: number; // dia fracionário
  fim: number;
  sem_capacidade: boolean;
}

export interface OpcoesProg {
  hoje: string;
  fracaoInicialHoje?: number; // quanto do turno de hoje já passou (0 a 1)
  horizonteDias?: number;
}

export function compararPrioridade(a: TarefaProg, b: TarefaProg): number {
  const andamento = (t: TarefaProg) => (t.status === "em_processo" || t.status === "pausada" ? 0 : 1);
  const liberada = (t: TarefaProg) => (t.op_liberada === false ? 1 : 0);
  return (
    andamento(a) - andamento(b) ||
    liberada(a) - liberada(b) ||
    (a.fila_manual ?? Number.MAX_SAFE_INTEGER) - (b.fila_manual ?? Number.MAX_SAFE_INTEGER) ||
    b.op_prioridade - a.op_prioridade ||
    a.op_data_necessidade.localeCompare(b.op_data_necessidade) ||
    a.op_id - b.op_id ||
    b.nivel - a.nivel ||
    a.sequencia - b.sequencia ||
    a.id - b.id
  );
}

export function programarFinito(
  tarefas: TarefaProg[],
  setores: SetorCapacidade[],
  cal: Calendario,
  op: OpcoesProg,
): Map<number, ResultadoTarefa> {
  const horizonte = op.horizonteDias ?? 730;
  const t0 = Math.min(0.999, Math.max(0, op.fracaoInicialHoje ?? 0));
  const setorPorId = new Map(setores.map((s) => [s.id, s]));
  const datas: string[] = [];
  const data = (d: number) => (datas[d] ??= somarDias(op.hoje, d));

  const pendentes = tarefas.filter((t) => t.status !== "concluida");
  const ids = new Set(pendentes.map((t) => t.id));
  const resultado = new Map<number, ResultadoTarefa>();
  const raias = new Map<number, number[]>(); // setor -> ponteiro de cada raia

  const capRaia = (s: SetorCapacidade, raia: number, d: number) =>
    raia < cal.recursosDia(s, data(d)) ? cal.minutosPorRecurso(s, data(d)) : 0;

  const alocar = (s: SetorCapacidade, raia: number, inicio: number, minutos: number) => {
    let t = inicio;
    let comeco: number | null = null;
    let resta = minutos;
    while (Math.floor(t) < horizonte) {
      const d = Math.floor(t);
      const cap = capRaia(s, raia, d);
      if (cap <= 0) {
        t = d + 1;
        continue;
      }
      if (comeco === null) comeco = t;
      if (resta <= 0) return { inicio: comeco, fim: t, ok: true };
      const frac = t - d;
      const disp = cap * (1 - frac);
      if (resta <= disp + 1e-9) return { inicio: comeco, fim: d + frac + resta / cap, ok: true };
      resta -= disp;
      t = d + 1;
    }
    return { inicio: comeco ?? inicio, fim: horizonte, ok: false };
  };

  const restantes = new Set(pendentes.map((t) => t.id));
  const porId = new Map(pendentes.map((t) => [t.id, t]));
  const depsAtivas = (t: TarefaProg) => t.deps.filter((d) => ids.has(d));

  while (restantes.size) {
    let melhor: TarefaProg | null = null;
    for (const id of restantes) {
      const t = porId.get(id)!;
      if (depsAtivas(t).some((d) => !resultado.has(d))) continue;
      if (!melhor || compararPrioridade(t, melhor) < 0) melhor = t;
    }
    if (!melhor) {
      // dependência circular ou para tarefa inexistente: programa o resto ignorando-a
      melhor = [...restantes].map((i) => porId.get(i)!).sort(compararPrioridade)[0];
      melhor.deps = [];
    }
    restantes.delete(melhor.id);

    const s = setorPorId.get(melhor.setor_id);
    const cedo = Math.max(t0, ...depsAtivas(melhor).map((d) => resultado.get(d)?.fim ?? t0));
    if (!s) {
      resultado.set(melhor.id, { inicio: cedo, fim: cedo, sem_capacidade: true });
      continue;
    }
    let ponteiros = raias.get(s.id);
    if (!ponteiros) raias.set(s.id, (ponteiros = new Array(Math.max(1, s.recursos)).fill(t0)));

    let escolha: { raia: number; inicio: number; fim: number; ok: boolean } | null = null;
    for (let r = 0; r < ponteiros.length; r++) {
      const a = alocar(s, r, Math.max(ponteiros[r], cedo), melhor.tempo_restante_min);
      if (!escolha || (a.ok && !escolha.ok) || (a.ok === escolha.ok && a.fim < escolha.fim - 1e-9)) escolha = { raia: r, ...a };
    }
    ponteiros[escolha!.raia] = escolha!.fim;
    resultado.set(melhor.id, { inicio: escolha!.inicio, fim: escolha!.fim, sem_capacidade: !escolha!.ok });
  }
  return resultado;
}

/** Converte dia fracionário em instante ISO, considerando jornada e eficiência do setor. */
export function paraInstante(
  hoje: string,
  diaFrac: number,
  horasTurno: number,
  inicioTurnoHora = 7,
  offsetUtcHoras = -3,
): string {
  const d = Math.floor(diaFrac);
  const frac = diaFrac - d;
  const data = somarDias(hoje, d);
  const [a, m, dd] = data.split("-").map(Number);
  const minutos = Math.round(inicioTurnoHora * 60 + frac * horasTurno * 60);
  const ms = Date.UTC(a, m - 1, dd, 0, minutos) - offsetUtcHoras * 3_600_000;
  return new Date(ms).toISOString();
}

export function diaDoFim(hoje: string, diaFrac: number): string {
  // fim exatamente no início de um dia pertence ao dia anterior
  const d = Math.ceil(diaFrac) - 1;
  return somarDias(hoje, Math.max(0, d));
}

export interface CargaSemana {
  setor_id: number;
  semana: string; // segunda-feira
  carga_min: number;
  capacidade_min: number;
  atrasada_min: number; // carga que já deveria ter sido feita
}

export function cargaNecessaria(
  tarefas: TarefaProg[],
  setores: SetorCapacidade[],
  cal: Calendario,
  hoje: string,
  semanas: number,
): CargaSemana[] {
  const pendentes = tarefas.filter((t) => t.status !== "concluida");
  const porId = new Map(pendentes.map((t) => [t.id, t]));
  const sucessores = new Map<number, number[]>();
  for (const t of pendentes)
    for (const d of t.deps) if (porId.has(d)) sucessores.set(d, [...(sucessores.get(d) ?? []), t.id]);
  const setorPorId = new Map(setores.map((s) => [s.id, s]));

  // índice de dias úteis genérico (seg-sex), suficiente para distribuir carga
  const util = (d: string) => {
    const w = diaSemana(d);
    return w !== 0 && w !== 6;
  };
  const cacheUtil = new Map<string, number>();
  const diaUtil = (data: string) => {
    const c = cacheUtil.get(data);
    if (c !== undefined) return c;
    const dias = diferencaDias(data, hoje);
    let r = 0;
    if (dias >= 0) for (let i = 0; i < dias; i++) r += util(somarDias(hoje, i)) ? 1 : 0;
    else for (let i = dias; i < 0; i++) r -= util(somarDias(hoje, i)) ? 1 : 0;
    cacheUtil.set(data, r);
    return r;
  };
  const deDiaUtil = (u: number) => {
    let alvo = Math.floor(u);
    let data = hoje;
    while (!util(data)) data = somarDias(data, 1);
    while (alvo > 0) {
      data = somarDias(data, 1);
      if (util(data)) alvo--;
    }
    return data;
  };

  const inicioTarde = new Map<number, number>();
  const calcular = (id: number, pilha = new Set<number>()): number => {
    const memo = inicioTarde.get(id);
    if (memo !== undefined) return memo;
    const t = porId.get(id)!;
    if (pilha.has(id)) return diaUtil(t.op_data_necessidade) + 1;
    pilha.add(id);
    const suc = sucessores.get(id) ?? [];
    const fimTarde = suc.length
      ? Math.min(...suc.map((s) => calcular(s, pilha)))
      : diaUtil(t.op_data_necessidade) + 1;
    const s = setorPorId.get(t.setor_id);
    const minDia = s ? Number(s.horas_turno) * 60 * Number(s.eficiencia) : 480;
    const r = fimTarde - t.tempo_restante_min / minDia;
    inicioTarde.set(id, r);
    pilha.delete(id);
    return r;
  };

  const segunda0 = segundaDaSemana(hoje);
  const semanasLista = Array.from({ length: semanas }, (_, i) => somarDias(segunda0, 7 * i));
  const mapa = new Map<string, CargaSemana>();
  for (const s of setores)
    for (const sem of semanasLista)
      mapa.set(`${s.id}|${sem}`, {
        setor_id: s.id,
        semana: sem,
        carga_min: 0,
        capacidade_min: arred(capacidadeSemana(cal, s, sem), 0),
        atrasada_min: 0,
      });

  for (const t of pendentes) {
    const ini = calcular(t.id);
    const atrasada = ini < 0;
    const sem = atrasada ? segunda0 : segundaDaSemana(deDiaUtil(ini));
    const c = mapa.get(`${t.setor_id}|${sem}`);
    if (!c) continue; // fora do horizonte
    c.carga_min = arred(c.carga_min + t.tempo_restante_min, 0);
    if (atrasada) c.atrasada_min = arred(c.atrasada_min + t.tempo_restante_min, 0);
  }
  return [...mapa.values()];
}
