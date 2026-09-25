// Calendário de trabalho por setor: dias úteis, feriados e indisponibilidades
// (ex.: máquina parada para adequação NR12 tira um recurso do setor).

import { diaSemana, somarDias } from "./datas";
import type { Indisponibilidade, SetorCapacidade } from "./tipos";

export interface Calendario {
  /** horas trabalhadas no dia (0 = não trabalha), antes de recursos/eficiência */
  horasDia(setor: SetorCapacidade, data: string): number;
  /** quantos recursos do setor estão disponíveis no dia */
  recursosDia(setor: SetorCapacidade, data: string): number;
  /** minutos efetivos de UM recurso no dia (horas × 60 × eficiência) */
  minutosPorRecurso(setor: SetorCapacidade, data: string): number;
  /** minutos efetivos do setor inteiro no dia */
  minutosSetor(setor: SetorCapacidade, data: string): number;
}

export function criarCalendario(
  excecoes: Map<string, number>,
  indisponibilidades: Indisponibilidade[],
  diasUteis: number[] = [1, 2, 3, 4, 5],
): Calendario {
  const horasDia = (setor: SetorCapacidade, data: string) => {
    const ex = excecoes.get(data);
    if (ex !== undefined) return ex;
    return diasUteis.includes(diaSemana(data)) ? Number(setor.horas_turno) : 0;
  };
  const recursosDia = (setor: SetorCapacidade, data: string) => {
    let r = setor.recursos;
    for (const i of indisponibilidades) {
      if (i.setor_id === setor.id && data >= i.inicio && data <= i.fim) r -= i.recursos_indisponiveis;
    }
    return Math.max(0, r);
  };
  const minutosPorRecurso = (setor: SetorCapacidade, data: string) => horasDia(setor, data) * 60 * Number(setor.eficiencia);
  return {
    horasDia,
    recursosDia,
    minutosPorRecurso,
    minutosSetor: (s, d) => minutosPorRecurso(s, d) * recursosDia(s, d),
  };
}

export function capacidadeSemana(cal: Calendario, setor: SetorCapacidade, segunda: string): number {
  let t = 0;
  for (let i = 0; i < 7; i++) t += cal.minutosSetor(setor, somarDias(segunda, i));
  return t;
}
