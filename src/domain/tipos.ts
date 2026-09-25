export type TipoItem = "produto" | "conjunto" | "peca" | "materia_prima" | "componente_comprado";
export type OrigemItem = "fabricado" | "comprado";
export type PoliticaItem = "sob_pedido" | "supermercado";

export interface ItemEng {
  id: number;
  codigo: string;
  descricao: string;
  unidade?: string;
  tipo: TipoItem;
  origem: OrigemItem;
  politica: PoliticaItem;
  lead_time_dias: number;
  estoque_seguranca: number;
  estoque_min: number;
  estoque_max: number;
  lote_minimo: number;
  lote_multiplo: number;
}

export interface LinhaEstrutura {
  pai_id: number;
  filho_id: number;
  quantidade: number;
  perda_pct: number;
}

export interface OperacaoRoteiro {
  id: number;
  item_id: number;
  sequencia: number;
  setor_id: number;
  descricao: string;
  setup_min: number;
  tempo_unit_min: number;
}

export interface SetorCapacidade {
  id: number;
  recursos: number;
  horas_turno: number;
  eficiencia: number;
}

export interface Indisponibilidade {
  setor_id: number;
  inicio: string;
  fim: string;
  recursos_indisponiveis: number;
}

export class ErroDominio extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "ErroDominio";
  }
}

export function arred(n: number, casas = 4): number {
  const f = 10 ** casas;
  return Math.round(n * f) / f;
}

export function agruparPor<T, K>(lista: T[], chave: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const x of lista) {
    const k = chave(x);
    const arr = m.get(k);
    if (arr) arr.push(x);
    else m.set(k, [x]);
  }
  return m;
}
