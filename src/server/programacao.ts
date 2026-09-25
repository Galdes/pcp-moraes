import { sql, type Sql } from "@/lib/db";
import { cargaNecessaria, diaDoFim, paraInstante, programarFinito, type TarefaProg } from "@/domain/programacao";
import { hojeNoFuso, segundaDaSemana, somarDias } from "@/domain/datas";
import { ErroDominio } from "@/domain/tipos";
import { carregarCalendario, carregarSetores } from "./engenharia";
import { auditar } from "./auditoria";

const INICIO_TURNO = Number(process.env.INICIO_TURNO_HORA ?? 7);

async function carregarTarefasAbertas(tx: Sql): Promise<TarefaProg[]> {
  const rows = await tx`
    select t.id, t.op_id, t.setor_id, t.status, t.fila_manual, t.nivel, t.sequencia, t.tempo_previsto_min,
      o.prioridade as op_prioridade, o.data_necessidade as op_data_necessidade, o.status <> 'firmada' as op_liberada,
      coalesce((select sum(extract(epoch from (coalesce(a.fim, now()) - a.inicio)) / 60) from apontamentos a where a.tarefa_id = t.id), 0) as realizado_min,
      coalesce(array(select d.depende_de_id from tarefa_dependencias d where d.tarefa_id = t.id), '{}') as deps
    from tarefas t join ordens_producao o on o.id = t.op_id
    where o.status in ('firmada', 'liberada', 'em_processo') and t.status <> 'concluida'`;
  return rows.map((r) => {
    const previsto = Number(r.tempo_previsto_min);
    const realizado = Number(r.realizado_min);
    // tarefa em andamento: o que falta, com piso de 10% do previsto (nunca "zero" enquanto aberta)
    const restante = r.status === "pendente" ? previsto : Math.max(previsto - realizado, previsto * 0.1);
    return {
      id: r.id as number,
      op_id: r.op_id as number,
      setor_id: r.setor_id as number,
      status: r.status as TarefaProg["status"],
      fila_manual: r.fila_manual as number | null,
      nivel: r.nivel as number,
      sequencia: r.sequencia as number,
      tempo_restante_min: Math.round(restante * 100) / 100,
      op_prioridade: r.op_prioridade as number,
      op_data_necessidade: r.op_data_necessidade as string,
      op_liberada: r.op_liberada as boolean,
      deps: (r.deps as number[]).map(Number),
    };
  });
}

/** Recalcula início/fim previstos de todas as tarefas e OPs abertas. */
export async function reprogramar(agora = new Date()) {
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`select pg_advisory_xact_lock(4242)`; // uma reprogramação por vez
    const hoje = hojeNoFuso(agora);
    const setores = await carregarSetores(t);
    const cal = await carregarCalendario(t);
    const tarefas = await carregarTarefasAbertas(t);
    const horasAgora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora));
    const minutos = agora.getUTCMinutes();
    const hTurnoPadrao = setores.length ? Number(setores[0].horas_turno) : 8.8;
    const fracao = Math.max(0, Math.min(0.999, (horasAgora + minutos / 60 - INICIO_TURNO) / hTurnoPadrao));
    const r = programarFinito(tarefas, setores, cal, { hoje, fracaoInicialHoje: fracao });
    const hSetor = new Map(setores.map((s) => [s.id, Number(s.horas_turno)]));

    const porOp = new Map<number, { ini: number; fim: number }>();
    const updates: { id: number; inicio: string; fim: string }[] = [];
    for (const tf of tarefas) {
      const x = r.get(tf.id);
      if (!x) continue;
      const h = hSetor.get(tf.setor_id) ?? 8.8;
      updates.push({ id: tf.id, inicio: paraInstante(hoje, x.inicio, h, INICIO_TURNO), fim: paraInstante(hoje, x.fim, h, INICIO_TURNO) });
      const o = porOp.get(tf.op_id);
      porOp.set(tf.op_id, { ini: Math.min(o?.ini ?? Infinity, x.inicio), fim: Math.max(o?.fim ?? -Infinity, x.fim) });
    }
    if (updates.length) {
      await t`
        update tarefas as tf set inicio_previsto = u.inicio::timestamptz, fim_previsto = u.fim::timestamptz
        from (select * from jsonb_to_recordset(${t.json(updates as never)}) as x(id int, inicio text, fim text)) u
        where tf.id = u.id`;
    }
    for (const [opId, v] of porOp) {
      await t`update ordens_producao set inicio_previsto = ${paraInstante(hoje, v.ini, hTurnoPadrao, INICIO_TURNO)},
                fim_previsto = ${paraInstante(hoje, v.fim, hTurnoPadrao, INICIO_TURNO)} where id = ${opId}`;
    }
    const atrasadas = [...porOp.entries()].filter(([opId, v]) => {
      const tf = tarefas.find((x) => x.op_id === opId)!;
      return diaDoFim(hoje, v.fim) > tf.op_data_necessidade;
    }).length;
    return { tarefas: tarefas.length, ops: porOp.size, atrasadas };
  });
}

export async function cargaPorSetor(semanas = 6) {
  const hoje = hojeNoFuso();
  const setores = await carregarSetores(sql);
  const cal = await carregarCalendario(sql);
  const tarefas = await carregarTarefasAbertas(sql);
  const carga = cargaNecessaria(tarefas, setores, cal, hoje, semanas);
  return { setores, carga };
}

export async function moverNaFila(tarefaId: number, direcao: "subir" | "descer" | "topo" | "limpar", usuarioId: number) {
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [alvo] = await t`select id, setor_id from tarefas where id = ${tarefaId}`;
    if (!alvo) throw new ErroDominio("Tarefa não encontrada");
    // fila atual do setor na ordem exibida
    const fila = await t`
      select tf.id from tarefas tf join ordens_producao o on o.id = tf.op_id
      where tf.setor_id = ${alvo.setor_id} and tf.status <> 'concluida' and o.status in ('firmada', 'liberada', 'em_processo')
      order by tf.fila_manual nulls last, tf.inicio_previsto nulls last, o.prioridade desc, o.data_necessidade, tf.id`;
    const ids = fila.map((f) => f.id as number);
    const i = ids.indexOf(tarefaId);
    if (i < 0 && direcao !== "limpar") throw new ErroDominio("Esta etapa não está mais na fila do setor");
    if (direcao === "limpar") {
      await t`update tarefas set fila_manual = null where id = ${tarefaId}`;
    } else {
      ids.splice(i, 1);
      const novo = direcao === "topo" ? 0 : direcao === "subir" ? Math.max(0, i - 1) : Math.min(ids.length, i + 1);
      ids.splice(novo, 0, tarefaId);
      // fixa a posição só até o item movido; o resto segue a regra automática
      const fixar = ids.slice(0, Math.max(novo + 1, ids.indexOf(tarefaId) + 1));
      for (let k = 0; k < fixar.length; k++) await t`update tarefas set fila_manual = ${k + 1} where id = ${fixar[k]}`;
    }
    await auditar(usuarioId, "tarefa", tarefaId, `fila:${direcao}`, undefined, t);
  });
  await reprogramar();
}

// ---------- programa semanal ----------
export async function programaDaSemana(semana: string) {
  const [p] = await sql`select p.*, u.nome as aprovado_por_nome from programas_semanais p left join usuarios u on u.id = p.aprovado_por where semana = ${semana}`;
  return p ?? null;
}

/** Aprova o programa: congela as tarefas previstas para terminar na semana. */
export async function aprovarPrograma(semana: string, usuarioId: number, observacao?: string) {
  const seg = segundaDaSemana(semana);
  const fimSemana = somarDias(seg, 7);
  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    const [p] = await t`
      insert into programas_semanais (semana, status, aprovado_por, aprovado_em, observacao)
      values (${seg}, 'aprovado', ${usuarioId}, now(), ${observacao ?? null})
      on conflict (semana) do update set status = 'aprovado', aprovado_por = excluded.aprovado_por, aprovado_em = now(),
        observacao = excluded.observacao
      returning id`;
    await t`delete from programa_itens where programa_id = ${p.id}`;
    const r = await t`
      insert into programa_itens (programa_id, tarefa_id)
      select ${p.id}, tf.id from tarefas tf join ordens_producao o on o.id = tf.op_id
      where o.status in ('firmada', 'liberada', 'em_processo') and tf.status <> 'concluida'
        and (tf.fim_previsto at time zone 'America/Sao_Paulo')::date < ${fimSemana}::date
      returning tarefa_id`;
    await auditar(usuarioId, "programa", seg, "aprovado", { tarefas: r.length }, t);
    return { semana: seg, tarefas: r.length };
  });
}
