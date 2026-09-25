// Apontamento no posto de trabalho (tablet).
// Cada ação chega com uma chave de idempotência gerada no tablet: se a rede
// cair e o tablet reenviar, a ação não é aplicada duas vezes.

import { z } from "zod";
import { sql, type Sql } from "@/lib/db";
import { ErroDominio } from "@/domain/tipos";
import { verificarConclusaoOP } from "./ops";

export const AcaoPosto = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("iniciar"), tarefa_id: z.number().int() }),
  z.object({
    tipo: z.literal("pausar"),
    tarefa_id: z.number().int(),
    motivo_id: z.number().int(),
    qtd_boa: z.number().min(0).default(0),
    qtd_refugo: z.number().min(0).default(0),
    motivo_refugo_id: z.number().int().nullable().optional(),
    observacao: z.string().max(500).optional(),
  }),
  z.object({ tipo: z.literal("retomar"), tarefa_id: z.number().int() }),
  z.object({
    tipo: z.literal("concluir"),
    tarefa_id: z.number().int(),
    qtd_boa: z.number().min(0),
    qtd_refugo: z.number().min(0).default(0),
    motivo_refugo_id: z.number().int().nullable().optional(),
  }),
  z.object({
    tipo: z.literal("parada_setor"),
    setor_id: z.number().int(),
    motivo_id: z.number().int(),
    observacao: z.string().max(500).optional(),
  }),
  z.object({ tipo: z.literal("encerrar_parada"), parada_id: z.number().int() }),
]);
export type AcaoPosto = z.infer<typeof AcaoPosto>;

export async function executarAcao(
  chave: string,
  acao: AcaoPosto,
  usuarioId: number,
  quando: Date = new Date(),
): Promise<{ ok: true; repetida?: boolean; mensagem: string }> {
  if (!/^[\w-]{8,80}$/.test(chave)) throw new ErroDominio("Chave de idempotência inválida");
  const [ja] = await sql`select resultado from acoes_idempotentes where chave = ${chave}`;
  if (ja) return { ...(ja.resultado as { ok: true; mensagem: string }), repetida: true };

  return sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    // trava a chave dentro da transação: duas requisições simultâneas não passam
    const ins = await t`insert into acoes_idempotentes (chave, resultado) values (${chave}, '{}') on conflict do nothing returning chave`;
    if (!ins.length) {
      const [r] = await t`select resultado from acoes_idempotentes where chave = ${chave}`;
      return { ...(r.resultado as { ok: true; mensagem: string }), repetida: true };
    }
    const mensagem = await aplicar(t, acao, usuarioId, quando);
    const resultado = { ok: true as const, mensagem };
    await t`update acoes_idempotentes set resultado = ${t.json(resultado)} where chave = ${chave}`;
    return resultado;
  }) as Promise<{ ok: true; mensagem: string }>;
}

async function tarefaParaAtualizar(t: Sql, id: number) {
  const [x] = await t`
    select tf.*, o.status as op_status, o.id as op_id, o.numero as op_numero
    from tarefas tf join ordens_producao o on o.id = tf.op_id where tf.id = ${id} for update of tf`;
  if (!x) throw new ErroDominio("Tarefa não encontrada");
  return x;
}

async function fecharApontamentoAberto(t: Sql, tarefaId: number, quando: Date, boa: number, refugo: number, motivoRefugo: number | null) {
  const r = await t`
    update apontamentos set fim = greatest(${quando}::timestamptz, inicio), qtd_boa = ${boa}, qtd_refugo = ${refugo}, motivo_refugo_id = ${motivoRefugo}
    where tarefa_id = ${tarefaId} and fim is null returning id`;
  return r.length > 0;
}

async function aplicar(t: Sql, a: AcaoPosto, usuarioId: number, quando: Date): Promise<string> {
  switch (a.tipo) {
    case "iniciar": {
      const x = await tarefaParaAtualizar(t, a.tarefa_id);
      if (!["liberada", "em_processo"].includes(x.op_status)) throw new ErroDominio(`OP ${x.op_numero} não está liberada`);
      if (x.status !== "pendente") throw new ErroDominio(`Tarefa já está ${x.status}`);
      const [dep] = await t`
        select count(*)::int as n from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id
        where d.tarefa_id = ${a.tarefa_id} and p.status <> 'concluida'`;
      if (dep.n > 0) throw new ErroDominio("Etapa anterior ainda não terminou");
      await t`insert into apontamentos (tarefa_id, usuario_id, inicio) values (${a.tarefa_id}, ${usuarioId}, ${quando})`;
      await t`update tarefas set status = 'em_processo', iniciada_em = coalesce(iniciada_em, ${quando}), updated_at = now() where id = ${a.tarefa_id}`;
      await t`update ordens_producao set status = 'em_processo', iniciada_em = coalesce(iniciada_em, ${quando}), updated_at = now()
              where id = ${x.op_id} and status = 'liberada'`;
      return `Iniciada: ${x.descricao}`;
    }
    case "pausar": {
      const x = await tarefaParaAtualizar(t, a.tarefa_id);
      if (x.status !== "em_processo") throw new ErroDominio("Só é possível pausar tarefa em processo");
      await fecharApontamentoAberto(t, a.tarefa_id, quando, a.qtd_boa, a.qtd_refugo, a.motivo_refugo_id ?? null);
      await t`insert into paradas (setor_id, tarefa_id, motivo_id, usuario_id, inicio, observacao)
              values (${x.setor_id}, ${a.tarefa_id}, ${a.motivo_id}, ${usuarioId}, ${quando}, ${a.observacao ?? null})`;
      await t`update tarefas set status = 'pausada', qtd_boa = qtd_boa + ${a.qtd_boa}, qtd_refugo = qtd_refugo + ${a.qtd_refugo},
              updated_at = now() where id = ${a.tarefa_id}`;
      return "Pausada";
    }
    case "retomar": {
      const x = await tarefaParaAtualizar(t, a.tarefa_id);
      if (x.status !== "pausada") throw new ErroDominio("Tarefa não está pausada");
      await t`update paradas set fim = greatest(${quando}::timestamptz, inicio) where tarefa_id = ${a.tarefa_id} and fim is null`;
      await t`insert into apontamentos (tarefa_id, usuario_id, inicio) values (${a.tarefa_id}, ${usuarioId}, ${quando})`;
      await t`update tarefas set status = 'em_processo', updated_at = now() where id = ${a.tarefa_id}`;
      return "Retomada";
    }
    case "concluir": {
      const x = await tarefaParaAtualizar(t, a.tarefa_id);
      if (!["em_processo", "pausada"].includes(x.status)) throw new ErroDominio("Tarefa não foi iniciada");
      const totalBoa = Number(x.qtd_boa) + a.qtd_boa;
      if (totalBoa <= 0) throw new ErroDominio("Informe a quantidade boa produzida");
      if (a.qtd_refugo > 0 && !a.motivo_refugo_id) throw new ErroDominio("Informe o motivo do refugo");
      if (x.status === "pausada") {
        await t`update paradas set fim = greatest(${quando}::timestamptz, inicio) where tarefa_id = ${a.tarefa_id} and fim is null`;
        // registro sem duração só para guardar a quantidade informada no encerramento
        await t`insert into apontamentos (tarefa_id, usuario_id, inicio, fim, qtd_boa, qtd_refugo, motivo_refugo_id)
                values (${a.tarefa_id}, ${usuarioId}, ${quando}, ${quando}, ${a.qtd_boa}, ${a.qtd_refugo}, ${a.motivo_refugo_id ?? null})`;
      } else {
        await fecharApontamentoAberto(t, a.tarefa_id, quando, a.qtd_boa, a.qtd_refugo, a.motivo_refugo_id ?? null);
      }
      await t`update tarefas set status = 'concluida', concluida_em = ${quando}, qtd_boa = qtd_boa + ${a.qtd_boa},
              qtd_refugo = qtd_refugo + ${a.qtd_refugo}, updated_at = now() where id = ${a.tarefa_id}`;
      const fechou = await verificarConclusaoOP(t, x.op_id, usuarioId, quando);
      return fechou ? `Concluída. OP ${x.op_numero} finalizada!` : "Concluída";
    }
    case "parada_setor": {
      const [aberta] = await t`select id from paradas where setor_id = ${a.setor_id} and tarefa_id is null and fim is null`;
      if (aberta) throw new ErroDominio("Já existe uma parada de setor aberta");
      await t`insert into paradas (setor_id, motivo_id, usuario_id, inicio, observacao)
              values (${a.setor_id}, ${a.motivo_id}, ${usuarioId}, ${quando}, ${a.observacao ?? null})`;
      return "Parada registrada";
    }
    case "encerrar_parada": {
      const r = await t`update paradas set fim = greatest(${quando}::timestamptz, inicio) where id = ${a.parada_id} and fim is null returning id`;
      if (!r.length) throw new ErroDominio("Parada não encontrada ou já encerrada");
      return "Parada encerrada";
    }
  }
}

/** Fila do setor para o tablet: prontas, em andamento e aguardando etapa anterior. */
export async function filaDoSetor(setorId: number) {
  return sql`
    select tf.id, tf.descricao, tf.quantidade, tf.qtd_boa, tf.qtd_refugo, tf.status, tf.tempo_previsto_min,
      tf.fim_previsto, tf.fila_manual, tf.nivel, tf.sequencia,
      i.codigo as item_codigo, i.descricao as item_descricao,
      o.id as op_id, o.numero as op_numero, o.data_necessidade, o.prioridade,
      pi.codigo as produto_codigo, pi.descricao as produto_descricao,
      not exists (select 1 from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id
                  where d.tarefa_id = tf.id and p.status <> 'concluida') as pronta,
      (select a.inicio from apontamentos a where a.tarefa_id = tf.id and a.fim is null) as em_curso_desde,
      (select m.descricao from paradas pa join motivos_parada m on m.id = pa.motivo_id
        where pa.tarefa_id = tf.id and pa.fim is null limit 1) as motivo_pausa
    from tarefas tf
    join ordens_producao o on o.id = tf.op_id
    join itens i on i.id = tf.item_id
    join itens pi on pi.id = o.item_id
    where tf.setor_id = ${setorId} and o.status in ('liberada', 'em_processo') and tf.status <> 'concluida'
    order by case tf.status when 'em_processo' then 0 when 'pausada' then 1 else 2 end,
      tf.fila_manual nulls last, tf.inicio_previsto nulls last, o.prioridade desc, o.data_necessidade, tf.nivel desc, tf.sequencia`;
}
