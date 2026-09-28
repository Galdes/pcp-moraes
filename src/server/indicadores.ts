import { sql } from "@/lib/db";
import { calcularOEE, pareto } from "@/domain/indicadores";
import { hojeNoFuso, segundaDaSemana, somarDias } from "@/domain/datas";
import { carregarCalendario, carregarSetores } from "./engenharia";

const INICIO_TURNO = Number(process.env.INICIO_TURNO_HORA ?? 7);

/** Intervalo de datas [de, ate] (YYYY-MM-DD, inclusivo). */
export interface Periodo {
  de: string;
  ate: string;
}

/** Aceita "últimos N dias" (compatível com as chamadas antigas) ou um intervalo explícito. */
function normalizar(p: number | Periodo): Periodo {
  if (typeof p === "number") {
    const hoje = hojeNoFuso();
    return { de: somarDias(hoje, -p), ate: hoje };
  }
  return p;
}

/**
 * KPIs do topo do painel. Entregas (OTD, lead time) e aderência usam o período;
 * WIP e atrasadas são sempre a situação atual.
 */
export async function kpis(periodo: number | Periodo = 30) {
  const hoje = hojeNoFuso();
  const { de: desde, ate } = normalizar(periodo);
  const [e] = await sql`
    select count(*)::int as concluidas,
      count(*) filter (where (concluida_em at time zone 'America/Sao_Paulo')::date <= data_necessidade)::int as no_prazo,
      avg(extract(epoch from (concluida_em - liberada_em)) / 86400) filter (where liberada_em is not null) as lead_time_dias
    from ordens_producao where status = 'concluida' and origem = 'pedido'
      and (concluida_em at time zone 'America/Sao_Paulo')::date >= ${desde}
      and (concluida_em at time zone 'America/Sao_Paulo')::date <= ${ate}`;
  const [w] = await sql`
    select count(*) filter (where status in ('liberada', 'em_processo'))::int as wip,
      count(*) filter (where status in ('firmada', 'liberada', 'em_processo')
        and (data_necessidade < ${hoje} or (fim_previsto at time zone 'America/Sao_Paulo')::date > data_necessidade))::int as atrasadas
    from ordens_producao`;
  // aderência: programas aprovados de semanas já fechadas dentro do período
  // (padrão sem período explícito: só a semana passada, como antes)
  const ultimaFechada = somarDias(segundaDaSemana(somarDias(ate < hoje ? ate : hoje, 1)), -7);
  const semAnt = typeof periodo === "number" ? somarDias(segundaDaSemana(hoje), -7) : ultimaFechada;
  const primeira = typeof periodo === "number" ? semAnt : segundaDaSemana(desde);
  const [a] = await sql`
    select count(*)::int as planejadas, count(distinct p.semana)::int as semanas,
      count(*) filter (where t.status = 'concluida' and (t.concluida_em at time zone 'America/Sao_Paulo')::date < p.semana + 7)::int as cumpridas
    from programas_semanais p join programa_itens pi on pi.programa_id = p.id join tarefas t on t.id = pi.tarefa_id
    where p.semana >= ${primeira} and p.semana <= ${semAnt} and p.status = 'aprovado'`;
  return {
    otd: e.concluidas ? e.no_prazo / e.concluidas : null,
    concluidas: e.concluidas as number,
    lead_time_dias: e.lead_time_dias === null ? null : Number(e.lead_time_dias),
    wip: w.wip as number,
    atrasadas: w.atrasadas as number,
    aderencia: a.planejadas ? a.cumpridas / a.planejadas : null,
    aderencia_semana: semAnt,
    aderencia_primeira_semana: primeira,
    aderencia_semanas: a.semanas as number,
    aderencia_planejadas: a.planejadas as number,
  };
}

export async function paretoParadas(periodo: number | Periodo = 30) {
  const rows =
    typeof periodo === "number"
      ? await sql`
    select m.descricao, m.tipo, sum(extract(epoch from (coalesce(p.fim, now()) - p.inicio)) / 60) as minutos
    from paradas p join motivos_parada m on m.id = p.motivo_id
    where p.inicio >= now() - ${`${periodo} days`}::interval and m.tipo <> 'planejada'
    group by m.descricao, m.tipo`
      : await sql`
    select m.descricao, m.tipo, sum(extract(epoch from (coalesce(p.fim, now()) - p.inicio)) / 60) as minutos
    from paradas p join motivos_parada m on m.id = p.motivo_id
    where (p.inicio at time zone 'America/Sao_Paulo')::date between ${periodo.de} and ${periodo.ate} and m.tipo <> 'planejada'
    group by m.descricao, m.tipo`;
  return pareto(rows.map((r) => ({ chave: r.descricao as string, valor: Number(r.minutos) })));
}

export async function opsAtrasadas() {
  const hoje = hojeNoFuso();
  return sql`
    select o.id, o.numero, o.status, o.data_necessidade, o.fim_previsto, o.falta_assumida_obs, i.codigo, i.descricao,
      (select string_agg(distinct s.nome, ', ') from tarefas t join setores s on s.id = t.setor_id
        where t.op_id = o.id and t.status <> 'concluida'
          and not exists (select 1 from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id where d.tarefa_id = t.id and p.status <> 'concluida')
      ) as setores_atuais,
      (select count(*) from paradas pa join tarefas t on t.id = pa.tarefa_id where t.op_id = o.id and pa.fim is null)::int as paradas_abertas
    from ordens_producao o join itens i on i.id = o.item_id
    where o.status in ('firmada', 'liberada', 'em_processo')
      and (o.data_necessidade < ${hoje} or (o.fim_previsto at time zone 'America/Sao_Paulo')::date > o.data_necessidade)
    order by o.data_necessidade`;
}

/** Faltas de material que travam OPs firmadas ou liberadas. */
export async function faltasMaterial() {
  return sql`
    with necessidade as (
      select m.item_id, sum(m.qtd_necessaria) as necessario, array_agg(o.numero order by o.numero) as ops
      from op_materiais m join ordens_producao o on o.id = m.op_id
      where o.status in ('firmada', 'liberada', 'em_processo') group by m.item_id)
    select i.codigo, i.descricao, i.unidade, n.necessario, coalesce(s.quantidade, 0) as saldo,
      n.necessario - coalesce(s.quantidade, 0) as falta, n.ops,
      (select min(r.data_prevista) from recebimentos_programados r where r.item_id = i.id and r.status = 'aberto') as proximo_recebimento
    from necessidade n join itens i on i.id = n.item_id left join estoque_saldos s on s.item_id = i.id
    where n.necessario > coalesce(s.quantidade, 0)
    order by falta desc limit 30`;
}

/** OEE por setor num intervalo de dias [de, ate]. */
export async function oeePorSetor(de: string, ate: string, apenasGargalo = false) {
  const setores = (await carregarSetores(sql)).filter((s) => !apenasGargalo || s.eh_gargalo);
  const cal = await carregarCalendario(sql);
  const fim = somarDias(ate, 1);
  const resultado = [];
  for (const s of setores) {
    let capacidade = 0;
    for (let d = de; d <= ate; d = somarDias(d, 1)) capacidade += cal.horasDia(s, d) * 60 * cal.recursosDia(s, d);
    // Intervalos recortados às janelas de turno (dias úteis, a partir de INICIO_TURNO_HORA):
    // um apontamento ou parada esquecido aberto durante a noite não distorce o OEE.
    const janelas = sql`
      select (d::date + make_interval(hours => ${INICIO_TURNO})) as ini,
             (d::date + make_interval(hours => ${INICIO_TURNO}) + make_interval(mins => ${Math.round(Number(s.horas_turno) * 60)})) as fim
      from generate_series(${de}::date, ${ate}::date, interval '1 day') d
      where extract(isodow from d) < 6`;
    const [p] = await sql`
      with j as (${janelas})
      select
        coalesce(sum(extract(epoch from (least(coalesce(p.fim, now()), j.fim) - greatest(p.inicio, j.ini))) / 60)
          filter (where m.tipo = 'planejada'), 0) as planejadas,
        coalesce(sum(extract(epoch from (least(coalesce(p.fim, now()), j.fim) - greatest(p.inicio, j.ini))) / 60)
          filter (where m.tipo <> 'planejada'), 0) as nao_planejadas
      from paradas p join motivos_parada m on m.id = p.motivo_id
      join j on p.inicio < j.fim and coalesce(p.fim, now()) > j.ini
      where p.setor_id = ${s.id}`;
    const [ap] = await sql`
      with j as (${janelas})
      select coalesce(sum(extract(epoch from (least(coalesce(a.fim, now()), j.fim) - greatest(a.inicio, j.ini))) / 60), 0) as apontado
      from apontamentos a join tarefas t on t.id = a.tarefa_id
      join j on a.inicio < j.fim and coalesce(a.fim, now()) > j.ini
      where t.setor_id = ${s.id}`;
    const [q] = await sql`
      select coalesce(sum(a.qtd_boa), 0) as boa, coalesce(sum(a.qtd_boa + a.qtd_refugo), 0) as total,
        coalesce(sum((a.qtd_boa + a.qtd_refugo) * coalesce(r.tempo_unit_min, 0)), 0) as padrao
      from apontamentos a join tarefas t on t.id = a.tarefa_id left join roteiros r on r.id = t.roteiro_id
      where t.setor_id = ${s.id} and a.fim >= ${de}::date and a.fim < ${fim}::date`;
    resultado.push({
      setor: s,
      ...calcularOEE({
        capacidade_min: Math.max(0, capacidade - Number(p.planejadas)),
        tempo_apontado_min: Number(ap.apontado),
        paradas_nao_planejadas_min: Number(p.nao_planejadas),
        producao_padrao_min: Number(q.padrao),
        qtd_boa: Number(q.boa),
        qtd_total: Number(q.total),
      }),
    });
  }
  return resultado;
}
