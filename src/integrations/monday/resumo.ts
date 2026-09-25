// Resumo por máquina para o Monday (acompanhamento da ESTG).
// O N8N lê este JSON (GET /api/export/monday com token) e atualiza um item
// por OP no quadro. O chão de fábrica deixa de ser controlado no Monday:
// lá fica só a visão executiva.

import { sql } from "@/lib/db";
import { hojeNoFuso, diferencaDias } from "@/domain/datas";

export async function resumoParaMonday() {
  const hoje = hojeNoFuso();
  const ops = await sql`
    select o.id, o.numero, o.status, o.quantidade, o.data_necessidade, o.prioridade,
      to_char(o.fim_previsto at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as fim_previsto,
      to_char(o.liberada_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as liberada_em,
      to_char(o.concluida_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as concluida_em,
      i.codigo, i.descricao, pv.numero as pedido, pv.cliente,
      coalesce(sum(t.tempo_previsto_min), 0) as horas_total_min,
      coalesce(sum(t.tempo_previsto_min) filter (where t.status = 'concluida'), 0) as horas_feitas_min,
      (select string_agg(distinct s.nome, ', ') from tarefas x join setores s on s.id = x.setor_id
        where x.op_id = o.id and x.status in ('em_processo', 'pausada')) as setores_em_execucao
    from ordens_producao o join itens i on i.id = o.item_id
    left join pedido_itens pi on pi.id = o.pedido_item_id left join pedidos_venda pv on pv.id = pi.pedido_id
    left join tarefas t on t.op_id = o.id
    where o.status in ('firmada', 'liberada', 'em_processo') or o.concluida_em > now() - interval '30 days'
    group by o.id, i.codigo, i.descricao, pv.numero, pv.cliente
    order by o.data_necessidade`;

  const statusMonday: Record<string, string> = {
    firmada: "Planejando",
    liberada: "Programado",
    em_processo: "Em execução",
    concluida: "Concluído",
  };

  return {
    gerado_em: new Date().toISOString(),
    maquinas: ops.map((o) => {
      const previsto = o.fim_previsto as string | null;
      const referencia = (o.concluida_em as string) ?? previsto ?? hoje;
      const diasAtraso = Math.max(0, diferencaDias(referencia, o.data_necessidade as string));
      const aberta = o.status !== "concluida";
      return {
        op: o.numero,
        maquina: `${o.codigo} - ${o.descricao}`,
        pedido: o.pedido,
        cliente: o.cliente,
        quantidade: Number(o.quantidade),
        status: aberta && diasAtraso > 0 ? "Em atraso" : statusMonday[o.status as string] ?? o.status,
        data_prometida: o.data_necessidade,
        fim_previsto: previsto,
        concluida_em: o.concluida_em,
        dias_atraso: diasAtraso,
        pct_concluido: Number(o.horas_total_min) ? Math.round((Number(o.horas_feitas_min) / Number(o.horas_total_min)) * 1000) / 10 : 0,
        setores_em_execucao: o.setores_em_execucao,
      };
    }),
  };
}
