// Indicadores de chão de fábrica e de gestão (puros, sem banco).

import { arred } from "./tipos";

// OEE para produção sob encomenda: a base é o tempo em que o setor TINHA
// trabalho (apontado ou parado por problema). O tempo ocioso por falta de
// carga não entra no OEE (distorceria a performance); ele aparece na
// "utilização", que compara esse tempo com a capacidade do turno.
export interface EntradaOEE {
  capacidade_min: number; // turno × recursos no período, já sem paradas planejadas
  tempo_apontado_min: number; // Σ duração dos apontamentos (inclui setup)
  paradas_nao_planejadas_min: number; // quebra, setup parado, falta de material...
  producao_padrao_min: number; // Σ tempo padrão × quantidade total produzida
  qtd_boa: number;
  qtd_total: number;
}

export interface ResultadoOEE {
  tempo_programado_min: number;
  tempo_operando_min: number;
  disponibilidade: number;
  performance: number;
  qualidade: number;
  oee: number;
  utilizacao: number;
}

export function calcularOEE(e: EntradaOEE): ResultadoOEE {
  const operando = Math.max(0, e.tempo_apontado_min);
  const programado = operando + Math.max(0, e.paradas_nao_planejadas_min);
  const disponibilidade = programado > 0 ? operando / programado : 0;
  // performance > 100% indica tempo padrão folgado: não é cortado, é sinalizado na tela
  const performance = operando > 0 ? e.producao_padrao_min / operando : 0;
  const qualidade = e.qtd_total > 0 ? e.qtd_boa / e.qtd_total : 0;
  return {
    tempo_programado_min: arred(programado, 1),
    tempo_operando_min: arred(operando, 1),
    disponibilidade: arred(disponibilidade),
    performance: arred(performance),
    qualidade: arred(qualidade),
    oee: arred(disponibilidade * Math.min(performance, 1) * qualidade),
    utilizacao: e.capacidade_min > 0 ? arred(Math.min(1, programado / e.capacidade_min)) : 0,
  };
}

export interface ItemPareto {
  chave: string;
  valor: number;
  pct: number;
  pct_acumulado: number;
}

export function pareto(itens: { chave: string; valor: number }[]): ItemPareto[] {
  const agreg = new Map<string, number>();
  for (const i of itens) agreg.set(i.chave, (agreg.get(i.chave) ?? 0) + i.valor);
  const total = [...agreg.values()].reduce((a, b) => a + b, 0);
  let acum = 0;
  return [...agreg.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([chave, valor]) => {
      acum += valor;
      return {
        chave,
        valor: arred(valor, 1),
        pct: total ? arred(valor / total) : 0,
        pct_acumulado: total ? arred(acum / total) : 0,
      };
    });
}

/** Entregas no prazo: OP concluída até a data prometida (inclusive). */
export function otd(ops: { data_necessidade: string; concluida_em_data: string }[]): number | null {
  if (!ops.length) return null;
  return arred(ops.filter((o) => o.concluida_em_data <= o.data_necessidade).length / ops.length);
}

/** Aderência ao programa: tarefas do programa aprovado concluídas dentro da semana. */
export function aderencia(planejadas: number, cumpridas: number): number | null {
  return planejadas ? arred(cumpridas / planejadas) : null;
}

/** Duração em minutos de intervalos, recortados a uma janela [ini, fim). */
export function minutosNaJanela(
  intervalos: { inicio: Date; fim: Date | null }[],
  janelaIni: Date,
  janelaFim: Date,
  agora: Date,
): number {
  let t = 0;
  for (const i of intervalos) {
    const a = Math.max(i.inicio.getTime(), janelaIni.getTime());
    const b = Math.min((i.fim ?? agora).getTime(), janelaFim.getTime());
    if (b > a) t += (b - a) / 60_000;
  }
  return arred(t, 1);
}
