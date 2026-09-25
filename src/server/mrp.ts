import { sql, type Sql } from "@/lib/db";
import { calcularMRP } from "@/domain/mrp";
import { hojeNoFuso, segundaDaSemana } from "@/domain/datas";
import { ErroDominio } from "@/domain/tipos";
import { carregarEstrutura, carregarItens, saldosEstoque } from "./engenharia";
import { criarOPTx } from "./ops";
import { auditar } from "./auditoria";
import { enfileirarOmie } from "@/integrations/omie/outbox";

export async function executarMRP(usuarioId: number | null, semanas = 12) {
  const inicio = segundaDaSemana(hojeNoFuso());
  const itens = await carregarItens(sql);
  const estrutura = await carregarEstrutura(sql);
  const saldos = await saldosEstoque(sql);
  const recebimentos = await sql<{ item_id: number; quantidade: number; data: string }[]>`
    select item_id, quantidade, data_prevista as data from recebimentos_programados where status = 'aberto'`;
  const demandas = await sql<{ item_id: number; quantidade: number; data: string }[]>`
    select pi.item_id, pi.quantidade, p.data_entrega as data
    from pedido_itens pi join pedidos_venda p on p.id = pi.pedido_id where p.status = 'aberto'`;
  const opsAbertas = await sql<{ item_id: number; quantidade_total: number; quantidade_restante: number; data_necessidade: string; data_inicio: string | null }[]>`
    select item_id, quantidade as quantidade_total, greatest(quantidade - qtd_boa, 0) as quantidade_restante, data_necessidade,
      to_char(inicio_previsto at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as data_inicio
    from ordens_producao where status in ('firmada', 'liberada', 'em_processo')`;

  const r = calcularMRP({ inicio, semanas, itens: [...itens.values()], estrutura, saldos, recebimentos, demandas, opsAbertas });

  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [ex] = await t`insert into mrp_execucoes (executado_por, horizonte_semanas, semana_inicial, avisos)
                         values (${usuarioId}, ${semanas}, ${inicio}, ${t.json(r.avisos)}) returning id`;
    if (r.linhas.length) await t`insert into mrp_linhas ${t(r.linhas.map((l) => ({ execucao_id: ex.id, ...l })))}`;
    if (r.sugestoes.length) await t`insert into sugestoes ${t(r.sugestoes.map((s) => ({ execucao_id: ex.id, ...s })))}`;
    // sugestões de execuções antigas ainda abertas deixam de valer
    await t`update sugestoes set status = 'descartada' where status = 'aberta' and execucao_id <> ${ex.id}`;
    return { id: ex.id as number, sugestoes: r.sugestoes.length, avisos: r.avisos };
  });
}

export async function ultimaExecucao() {
  const [ex] = await sql`select e.*, u.nome as executado_por_nome from mrp_execucoes e left join usuarios u on u.id = e.executado_por order by e.id desc limit 1`;
  return ex ?? null;
}

export async function converterSugestaoEmOP(sugestaoId: number, usuarioId: number) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // reivindica a sugestão de forma atômica: o segundo clique não acha mais "aberta"
    const [s] = await t`
      update sugestoes set status = 'convertida' where id = ${sugestaoId} and status = 'aberta' and tipo = 'producao'
      returning item_id, quantidade, data_necessidade, execucao_id`;
    if (!s) throw new ErroDominio("Sugestão de produção não encontrada ou já tratada");
    const [i] = await t`select politica from itens where id = ${s.item_id}`;
    const op = await criarOPTx(
      t,
      {
        item_id: s.item_id as number,
        quantidade: Number(s.quantidade),
        data_necessidade: s.data_necessidade as string,
        origem: i.politica === "supermercado" ? "supermercado" : "mrp",
        observacao: `MRP execução ${s.execucao_id}`,
      },
      usuarioId,
    );
    await t`update sugestoes set op_id = ${op.id} where id = ${sugestaoId}`;
    return op;
  }) as Promise<{ id: number; numero: number; avisos: string[] }>;
}

/** Agrupa as sugestões de compra marcadas numa requisição de compra para o Omie. */
export async function enviarRequisicaoCompra(sugestaoIds: number[], usuarioId: number) {
  if (!sugestaoIds.length) throw new ErroDominio("Selecione ao menos uma sugestão de compra");
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const sugs = await t`select id, item_id, quantidade, data_necessidade from sugestoes
                         where id = any(${sugestaoIds}) and status = 'aberta' and tipo = 'compra' for update`;
    if (!sugs.length) throw new ErroDominio("Nenhuma sugestão de compra aberta selecionada");
    const referencia = `REQ-PCP-${Date.now().toString(36).toUpperCase()}`;
    const data = sugs.map((s) => s.data_necessidade as string).sort()[0];
    const itens = sugs.map((s) => ({ item_id: s.item_id as number, quantidade: Number(s.quantidade) }));
    await enfileirarOmie(t, "requisicao_compra", referencia, { data, itens, sugestoes: sugs.map((s) => s.id) });
    await t`update sugestoes set status = 'convertida' where id = any(${sugs.map((s) => s.id as number)})`;
    await auditar(usuarioId, "requisicao", referencia, "criada", { itens }, t);
    return { referencia, itens: itens.length };
  });
}
