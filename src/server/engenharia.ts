import type { Sql } from "@/lib/db";
import type { ItemEng, LinhaEstrutura, OperacaoRoteiro, SetorCapacidade, Indisponibilidade } from "@/domain/tipos";
import { criarCalendario } from "@/domain/calendario";

export async function carregarItens(tx: Sql): Promise<Map<number, ItemEng>> {
  const rows = await tx<ItemEng[]>`
    select id, codigo, descricao, unidade, tipo, origem, politica, lead_time_dias, estoque_seguranca,
           estoque_min, estoque_max, lote_minimo, lote_multiplo
    from itens where ativo`;
  return new Map(rows.map((r) => [r.id, r]));
}

export async function carregarEstrutura(tx: Sql): Promise<LinhaEstrutura[]> {
  return tx<LinhaEstrutura[]>`
    select e.pai_id, e.filho_id, e.quantidade, e.perda_pct
    from estrutura e join itens p on p.id = e.pai_id and p.ativo join itens f on f.id = e.filho_id and f.ativo`;
}

export async function carregarRoteiros(tx: Sql): Promise<OperacaoRoteiro[]> {
  return tx<OperacaoRoteiro[]>`select id, item_id, sequencia, setor_id, descricao, setup_min, tempo_unit_min from roteiros`;
}

export async function carregarSetores(tx: Sql) {
  return tx<(SetorCapacidade & { codigo: string; nome: string; sequencia: number; eh_gargalo: boolean })[]>`
    select id, codigo, nome, sequencia, recursos, horas_turno, eficiencia, eh_gargalo
    from setores where ativo order by sequencia, nome`;
}

export async function carregarCalendario(tx: Sql) {
  const ex = await tx<{ data: string; horas: number }[]>`select data, horas from calendario_excecoes`;
  const ind = await tx<Indisponibilidade[]>`select setor_id, inicio, fim, recursos_indisponiveis from indisponibilidades`;
  return criarCalendario(new Map(ex.map((e) => [e.data, Number(e.horas)])), ind);
}

export async function saldosEstoque(tx: Sql): Promise<Map<number, number>> {
  const rows = await tx<{ item_id: number; quantidade: number }[]>`select item_id, quantidade from estoque_saldos`;
  return new Map(rows.map((r) => [r.item_id, r.quantidade]));
}

/** Materiais comprometidos com OPs liberadas/em processo (o Omie só baixa na conclusão). */
export async function comprometidoPorItem(tx: Sql, excetoOp?: number): Promise<Map<number, number>> {
  const rows = await tx<{ item_id: number; qtd: number }[]>`
    select m.item_id, sum(m.qtd_necessaria)::numeric as qtd
    from op_materiais m join ordens_producao o on o.id = m.op_id
    where o.status in ('liberada', 'em_processo') and o.id <> ${excetoOp ?? 0}
    group by m.item_id`;
  return new Map(rows.map((r) => [r.item_id, Number(r.qtd)]));
}
