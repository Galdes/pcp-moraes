import { sql } from "@/lib/db";

export async function quadroKanban() {
  const setores = await sql`select id, codigo, nome, eh_gargalo, recursos from setores where ativo order by sequencia`;
  const tarefas = await sql`
    select t.id, t.setor_id, t.status, t.descricao, t.quantidade, t.qtd_boa, t.tempo_previsto_min, t.inicio_previsto, t.fim_previsto,
      i.codigo, i.descricao as item_descricao, o.numero, o.data_necessidade, o.prioridade,
      not exists (select 1 from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id where d.tarefa_id = t.id and p.status <> 'concluida') as pronta,
      (select a.inicio from apontamentos a where a.tarefa_id = t.id and a.fim is null) as desde,
      (select u.nome from apontamentos a join usuarios u on u.id = a.usuario_id where a.tarefa_id = t.id and a.fim is null) as operador,
      (select m.descricao from paradas p join motivos_parada m on m.id = p.motivo_id where p.tarefa_id = t.id and p.fim is null limit 1) as motivo,
      (select p.inicio from paradas p where p.tarefa_id = t.id and p.fim is null limit 1) as parada_desde
    from tarefas t join ordens_producao o on o.id = t.op_id join itens i on i.id = t.item_id
    where o.status in ('liberada', 'em_processo') and t.status <> 'concluida'
    order by t.fila_manual nulls last, t.inicio_previsto nulls last, o.prioridade desc, o.data_necessidade, t.id`;
  const paradasSetor = await sql`
    select p.id, p.setor_id, p.inicio, m.descricao from paradas p join motivos_parada m on m.id = p.motivo_id
    where p.tarefa_id is null and p.fim is null`;
  const concluidasHoje = await sql`
    select t.setor_id, count(*)::int as n from tarefas t
    where (t.concluida_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date group by t.setor_id`;
  const hoje = new Map(concluidasHoje.map((c) => [c.setor_id as number, c.n as number]));
  return setores.map((s) => {
    const ts = tarefas.filter((t) => t.setor_id === s.id);
    return {
      setor: s,
      emProcesso: ts.filter((t) => t.status === "em_processo"),
      paradas: ts.filter((t) => t.status === "pausada"),
      prontas: ts.filter((t) => t.status === "pendente" && t.pronta),
      aguardando: ts.filter((t) => t.status === "pendente" && !t.pronta),
      paradaSetor: paradasSetor.find((p) => p.setor_id === s.id) ?? null,
      concluidasHoje: hoje.get(s.id as number) ?? 0,
    };
  });
}
export type Quadro = Awaited<ReturnType<typeof quadroKanban>>;
