// Ciclo de vida da Ordem de Produção:
// sugerida → firmada → liberada → em_processo → concluida  (ou cancelada)
//
// - Criar/firmar: explode a estrutura e gera tarefas + kit de materiais.
// - Liberar: exige kit completo, ou falta assumida por alguém (fica registrado).
//   Ao liberar, a OP é enviada ao Omie (via outbox).
// - Concluir: acontece sozinha quando a última tarefa termina; o Omie recebe a
//   conclusão e faz a movimentação de estoque.

import { sql, type Sql } from "@/lib/db";
import { explodir, gerarTarefas } from "@/domain/estrutura";
import { calcularKit } from "@/domain/kitting";
import { ErroDominio } from "@/domain/tipos";
import { carregarEstrutura, carregarItens, carregarRoteiros, comprometidoPorItem, saldosEstoque } from "./engenharia";
import { auditar } from "./auditoria";
import { enfileirarOmie } from "@/integrations/omie/outbox";

export interface NovaOP {
  item_id: number;
  quantidade: number;
  data_necessidade: string;
  origem: "pedido" | "supermercado" | "manual" | "mrp";
  pedido_item_id?: number | null;
  prioridade?: number;
  observacao?: string | null;
  status?: "firmada" | "sugerida";
}

export async function criarOP(nova: NovaOP, usuarioId: number | null): Promise<{ id: number; numero: number; avisos: string[] }> {
  return sql.begin(async (tx) => criarOPTx(tx as unknown as Sql, nova, usuarioId)) as Promise<{ id: number; numero: number; avisos: string[] }>;
}

/** Cria a OP dentro de uma transação já aberta (quem chama controla travas e concorrência). */
export async function criarOPTx(t: Sql, nova: NovaOP, usuarioId: number | null): Promise<{ id: number; numero: number; avisos: string[] }> {
  if (!(nova.quantidade > 0)) throw new ErroDominio("Quantidade deve ser maior que zero");
  {
    const [op] = await t<{ id: number; numero: number }[]>`
      insert into ordens_producao (item_id, quantidade, origem, pedido_item_id, status, prioridade, data_necessidade, observacao, created_by)
      values (${nova.item_id}, ${nova.quantidade}, ${nova.origem}, ${nova.pedido_item_id ?? null}, ${nova.status ?? "firmada"},
              ${nova.prioridade ?? 0}, ${nova.data_necessidade}, ${nova.observacao ?? null}, ${usuarioId})
      returning id, numero`;
    const avisos = await explodirOP(t, op.id, nova.item_id, nova.quantidade);
    await auditar(usuarioId, "op", op.id, "criada", { ...nova, avisos }, t);
    return { ...op, avisos };
  }
}

/** (Re)gera tarefas, dependências e kit de uma OP ainda não liberada. */
async function explodirOP(tx: Sql, opId: number, itemId: number, quantidade: number): Promise<string[]> {
  const itens = await carregarItens(tx);
  const estrutura = await carregarEstrutura(tx);
  const roteiros = await carregarRoteiros(tx);
  const ex = explodir(itemId, quantidade, itens, estrutura);
  const { tarefas, avisos } = gerarTarefas(ex, roteiros, itens);

  await tx`delete from tarefas where op_id = ${opId}`;
  await tx`delete from op_materiais where op_id = ${opId}`;

  const ids = new Map<string, number>();
  for (const t of tarefas) {
    const [r] = await tx<{ id: number }[]>`
      insert into tarefas (op_id, item_id, roteiro_id, setor_id, sequencia, nivel, descricao, quantidade, tempo_previsto_min)
      values (${opId}, ${t.item_id}, ${t.roteiro_id}, ${t.setor_id}, ${t.sequencia}, ${t.nivel}, ${t.descricao}, ${t.quantidade}, ${t.tempo_previsto_min})
      returning id`;
    ids.set(t.chave, r.id);
  }
  const deps = tarefas.flatMap((t) => t.depende_de.map((d) => ({ tarefa_id: ids.get(t.chave)!, depende_de_id: ids.get(d)! })));
  if (deps.length) await tx`insert into tarefa_dependencias ${tx(deps)}`;
  const mats = [...ex.materiais].map(([item_id, q]) => ({ op_id: opId, item_id, qtd_necessaria: q }));
  if (mats.length) await tx`insert into op_materiais ${tx(mats)}`;
  return [...ex.avisos, ...avisos];
}

export async function reexplodirOP(opId: number, usuarioId: number) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [op] = await t`select item_id, quantidade, status from ordens_producao where id = ${opId} for update`;
    if (!op) throw new ErroDominio("OP não encontrada");
    if (!["sugerida", "firmada"].includes(op.status as string))
      throw new ErroDominio("Só é possível recalcular a estrutura de OP ainda não liberada");
    const avisos = await explodirOP(t, opId, op.item_id as number, Number(op.quantidade));
    await auditar(usuarioId, "op", opId, "reexplodida", { avisos }, t);
    return avisos;
  });
}

export async function kitDaOP(opId: number, tx: Sql = sql) {
  const mats = await tx<{ item_id: number; qtd_necessaria: number; codigo: string; descricao: string; unidade: string; origem: string }[]>`
    select m.item_id, m.qtd_necessaria, i.codigo, i.descricao, i.unidade, i.origem
    from op_materiais m join itens i on i.id = m.item_id where m.op_id = ${opId}`;
  const kit = calcularKit(
    mats.map((m) => ({ item_id: m.item_id, qtd: m.qtd_necessaria })),
    await saldosEstoque(tx),
    await comprometidoPorItem(tx, opId),
  );
  const info = new Map(mats.map((m) => [m.item_id, m]));
  return { completo: kit.completo, linhas: kit.linhas.map((l) => ({ ...l, ...info.get(l.item_id)! })) };
}

export async function liberarOP(opId: number, usuarioId: number, assumirFalta?: string | null) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // uma liberação por vez: duas OPs liberadas juntas não "enxergam" o mesmo saldo como livre
    await t`select pg_advisory_xact_lock(4243)`;
    const [op] = await t`select * from ordens_producao where id = ${opId} for update`;
    if (!op) throw new ErroDominio("OP não encontrada");
    if (op.status !== "firmada") throw new ErroDominio(`OP está ${op.status}: só OP firmada pode ser liberada`);
    const [{ n, raiz }] = await t`select count(*)::int as n, count(*) filter (where nivel = 0)::int as raiz from tarefas where op_id = ${opId}`;
    if (!n) throw new ErroDominio("OP sem tarefas: cadastre o roteiro dos itens antes de liberar");
    if (!raiz) throw new ErroDominio("O item da OP não tem roteiro (ex.: montagem final): cadastre-o e recalcule a estrutura antes de liberar");
    const kit = await kitDaOP(opId, t);
    if (!kit.completo && !assumirFalta?.trim())
      throw new ErroDominio("Kit incompleto: informe quem assume a falta e o motivo para liberar mesmo assim");
    await t`
      update ordens_producao set status = 'liberada', liberada_em = now(), updated_at = now(),
        falta_assumida_por = ${kit.completo ? null : usuarioId}, falta_assumida_obs = ${kit.completo ? null : assumirFalta!.trim()}
      where id = ${opId}`;
    await auditar(usuarioId, "op", opId, "liberada", { kit_completo: kit.completo, faltas: kit.linhas.filter((l) => l.falta > 0) }, t);
    await enfileirarOmie(t, "incluir_op", String(op.numero), { op_id: opId });
    return kit;
  });
}

export async function cancelarOP(opId: number, usuarioId: number, motivo: string) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [op] = await t`select status, numero from ordens_producao where id = ${opId} for update`;
    if (!op) throw new ErroDominio("OP não encontrada");
    if (["concluida", "cancelada"].includes(op.status as string)) throw new ErroDominio(`OP já está ${op.status}`);
    const [{ n }] = await t`select count(*)::int as n from apontamentos a join tarefas x on x.id = a.tarefa_id where x.op_id = ${opId}`;
    if (n && op.status === "em_processo" && !motivo.trim()) throw new ErroDominio("OP com apontamentos: informe o motivo");
    await t`update ordens_producao set status = 'cancelada', updated_at = now() where id = ${opId}`;
    await t`update apontamentos set fim = now() where fim is null and tarefa_id in (select id from tarefas where op_id = ${opId})`;
    await t`update paradas set fim = now() where fim is null and tarefa_id in (select id from tarefas where op_id = ${opId})`;
    await auditar(usuarioId, "op", opId, "cancelada", { motivo }, t);
    if (op.status !== "firmada" && op.status !== "sugerida") await enfileirarOmie(t, "cancelar_op", String(op.numero), { op_id: opId });
  });
}

export async function firmarOP(opId: number, usuarioId: number) {
  const r = await sql`update ordens_producao set status = 'firmada', updated_at = now() where id = ${opId} and status = 'sugerida' returning id`;
  if (!r.length) throw new ErroDominio("Só OP sugerida pode ser firmada");
  await auditar(usuarioId, "op", opId, "firmada");
}

export async function alterarPrioridade(opId: number, prioridade: number, dataNecessidade: string | null, usuarioId: number) {
  await sql`update ordens_producao set prioridade = ${prioridade},
              data_necessidade = coalesce(${dataNecessidade}, data_necessidade), updated_at = now()
            where id = ${opId} and status not in ('concluida', 'cancelada')`;
  await auditar(usuarioId, "op", opId, "prioridade", { prioridade, dataNecessidade });
}

/** Chamado quando uma tarefa é concluída: fecha a OP se tudo terminou. */
export async function verificarConclusaoOP(tx: Sql, opId: number, usuarioId: number, quando: Date = new Date()) {
  // trava a OP: dois tablets concluindo as duas últimas etapas ao mesmo tempo não deixam a OP aberta
  await tx`select id from ordens_producao where id = ${opId} for update`;
  const [r] = await tx<{ pendentes: number }[]>`
    select count(*) filter (where status <> 'concluida')::int as pendentes from tarefas where op_id = ${opId}`;
  if (r.pendentes > 0) return false;
  // quantidade boa da OP = menor quantidade boa entre as operações do item final (nível 0)
  const [q] = await tx<{ boa: number | null; refugo: number | null }[]>`
    select min(qtd_boa) as boa, sum(qtd_refugo) as refugo from tarefas where op_id = ${opId} and nivel = 0`;
  const [op] = await tx`
    update ordens_producao set status = 'concluida', concluida_em = ${quando}, updated_at = now(),
      qtd_boa = coalesce(${q.boa}, quantidade), qtd_refugo = coalesce(${q.refugo}, 0)
    where id = ${opId} and status in ('liberada', 'em_processo') returning numero`;
  if (!op) return false;
  await auditar(usuarioId, "op", opId, "concluida", q, tx);
  await enfileirarOmie(tx, "concluir_op", String(op.numero), { op_id: opId });
  return true;
}

/** Gera OP a partir de um item de pedido de venda (MTO). */
export async function criarOPDoPedido(pedidoItemId: number, usuarioId: number) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // trava o item do pedido: dois cliques não geram duas OPs
    const [pi] = await t`
      select pi.id, pi.item_id, pi.quantidade, p.data_entrega, p.numero
      from pedido_itens pi join pedidos_venda p on p.id = pi.pedido_id where pi.id = ${pedidoItemId} for update of pi`;
    if (!pi) throw new ErroDominio("Item de pedido não encontrado");
    const [{ ja }] = await t`select coalesce(sum(quantidade), 0) as ja from ordens_producao where pedido_item_id = ${pedidoItemId} and status <> 'cancelada'`;
    const falta = Number(pi.quantidade) - Number(ja);
    if (falta <= 0) throw new ErroDominio("Este item do pedido já está coberto por OP");
    return criarOPTx(
      t,
      { item_id: pi.item_id as number, quantidade: falta, data_necessidade: pi.data_entrega as string, origem: "pedido", pedido_item_id: pi.id as number, observacao: `Pedido ${pi.numero}` },
      usuarioId,
    );
  }) as Promise<{ id: number; numero: number; avisos: string[] }>;
}
