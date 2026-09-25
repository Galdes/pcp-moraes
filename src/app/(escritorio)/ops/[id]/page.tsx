import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, StatusOP, StatusTarefa, Vazio } from "@/components/ui";
import { fmtData, fmtDataHora, fmtMin, fmtQtd } from "@/lib/formato";
import { kitDaOP } from "@/server/ops";
import { exigir, ESCRITORIO, PODE_PLANEJAR } from "@/server/auth";
import { cancelarAction, firmarAction, liberarAction, prioridadeAction, reexplodirAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function DetalheOP({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const u = await exigir(...ESCRITORIO);
  const podePlanejar = PODE_PLANEJAR.includes(u.perfil) || u.perfil === "admin";
  const { id } = await params;
  const sp = await searchParams;
  const [op] = await sql`
    select o.*, i.codigo, i.descricao, i.unidade, pv.numero as pedido, pv.cliente, uf.nome as falta_por
    from ordens_producao o join itens i on i.id = o.item_id
    left join pedido_itens pi on pi.id = o.pedido_item_id left join pedidos_venda pv on pv.id = pi.pedido_id
    left join usuarios uf on uf.id = o.falta_assumida_por
    where o.id = ${Number(id) || 0}`;
  if (!op) notFound();
  const tarefas = await sql`
    select t.*, i.codigo, i.descricao as item_descricao, s.nome as setor,
      coalesce((select sum(extract(epoch from (coalesce(a.fim, now()) - a.inicio)) / 60) from apontamentos a where a.tarefa_id = t.id), 0) as realizado_min,
      (select case when count(*) = 0 then null when count(*) = 1 then min(pi.codigo) || ' (' || min(ps.nome) || ')'
              else count(*) || ' etapas (' || min(pi.codigo) || '...)' end
        from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id join itens pi on pi.id = p.item_id
        join setores ps on ps.id = p.setor_id where d.tarefa_id = t.id and p.status <> 'concluida') as aguardando
    from tarefas t join itens i on i.id = t.item_id join setores s on s.id = t.setor_id
    where t.op_id = ${op.id} order by t.nivel desc, i.codigo, t.sequencia`;
  const kit = await kitDaOP(op.id as number);
  const historico = await sql`select a.*, u.nome from auditoria a left join usuarios u on u.id = a.usuario_id where entidade = 'op' and entidade_id = ${String(op.id)} order by a.id desc limit 30`;
  const envios = await sql`select tipo, status, ultimo_erro, updated_at from outbox where sistema = 'omie' and referencia = ${String(op.numero)} order by id`;
  const aberta = !["concluida", "cancelada"].includes(op.status as string);
  const fimPrev = op.fim_previsto ? new Date(op.fim_previsto as Date).toISOString().slice(0, 10) : null;
  const risco = aberta && fimPrev && fimPrev > (op.data_necessidade as string);
  const minTotal = tarefas.reduce((a, t) => a + Number(t.tempo_previsto_min), 0);
  const minFeito = tarefas.filter((t) => t.status === "concluida").reduce((a, t) => a + Number(t.tempo_previsto_min), 0);

  return (
    <>
      <Cabecalho
        coord={`Ordem de produção · ${op.origem === "pedido" ? `pedido ${op.pedido}` : op.origem}`}
        titulo={`OP ${op.numero}`}
        sub={<><span className="font-mono">{op.codigo as string}</span> · {op.descricao as string}</>}
        acoes={
          <>
            <Link href={`/ops/${op.id}/ficha`} className="btn-sec">Ficha de produção (QR)</Link>
            {op.status === "sugerida" && podePlanejar && (
              <form action={firmarAction}><input type="hidden" name="op_id" value={op.id as number} /><button className="btn-pri">Firmar</button></form>
            )}
            {op.status === "firmada" && podePlanejar && (
              <form action={reexplodirAction}><input type="hidden" name="op_id" value={op.id as number} /><button className="btn-sec" title="Use depois de corrigir estrutura ou roteiro">Recalcular estrutura</button></form>
            )}
          </>
        }
      />
      <Aviso busca={sp} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Info rotulo="Status"><StatusOP s={op.status as string} /></Info>
        <Info rotulo="Quantidade">{fmtQtd(op.quantidade as number)} {op.unidade as string}{Number(op.qtd_boa) > 0 && <span className="text-xs text-apagado"> · {fmtQtd(op.qtd_boa as number)} boas</span>}</Info>
        <Info rotulo="Data prometida">{fmtData(op.data_necessidade as string)}</Info>
        <Info rotulo="Fim previsto"><span className={risco ? "font-semibold text-alerta" : ""}>{op.status === "concluida" ? `Concluída ${fmtDataHora(op.concluida_em as Date)}` : fmtDataHora(op.fim_previsto as Date)}</span>{risco && <div className="text-xs text-alerta">depois da promessa</div>}</Info>
        <Info rotulo="Avanço (horas-padrão)">{minTotal ? Math.round((minFeito / minTotal) * 100) : 0}% <span className="text-xs text-apagado">de {fmtMin(minTotal)}</span></Info>
        <Info rotulo="Cliente">{(op.cliente as string) ?? "–"}</Info>
      </div>
      {op.falta_assumida_obs && (
        <div className="mt-3 rounded-md border border-atencao/40 bg-atencao/5 px-4 py-2 text-sm">
          <b>Liberada com falta de material</b>, assumida por {op.falta_por as string}: {op.falta_assumida_obs as string}
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card titulo={`Kit de materiais · ${kit.completo ? "completo" : "incompleto"}`} corpo="p-0" acoes={<span className={`badge ${kit.completo ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"}`}>{kit.completo ? "pode liberar" : `${kit.linhas.filter((l) => l.falta > 0).length} faltas`}</span>}>
          {kit.linhas.length === 0 ? (
            <Vazio>Sem materiais: tudo é fabricado dentro da OP ou a estrutura não foi cadastrada.</Vazio>
          ) : (
            <div className="max-h-96 overflow-auto">
              <table className="tbl">
                <thead><tr><th>Material</th><th className="num">Necessário</th><th className="num">Saldo</th><th className="num">Outras OPs</th><th className="num">Disponível</th><th className="num">Falta</th></tr></thead>
                <tbody>
                  {kit.linhas.map((l) => (
                    <tr key={l.item_id} className={l.falta > 0 ? "bg-red-50/60" : ""}>
                      <td><span className="font-mono text-xs">{l.codigo}</span> <span className="text-xs text-apagado">{l.descricao}</span>{l.origem === "fabricado" && <span className="badge ml-1 bg-latao/20 text-latao-escuro">supermercado</span>}</td>
                      <td className="num">{fmtQtd(l.necessario)} {l.unidade}</td>
                      <td className="num">{fmtQtd(l.saldo)}</td>
                      <td className="num text-apagado">{fmtQtd(l.comprometido)}</td>
                      <td className="num">{fmtQtd(l.disponivel)}</td>
                      <td className={`num ${l.falta > 0 ? "font-semibold text-alerta" : "text-apagado"}`}>{l.falta > 0 ? fmtQtd(l.falta) : "ok"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-linha px-4 py-2 text-xs text-apagado">Disponível = saldo do Omie menos o que já está comprometido com OPs liberadas (o Omie só baixa o material quando a OP é concluída).</p>
        </Card>

        <div className="space-y-4">
          {op.status === "firmada" && podePlanejar && (
            <Card titulo="Liberar para a produção">
              <form action={liberarAction} className="space-y-3">
                <input type="hidden" name="op_id" value={op.id as number} />
                {!kit.completo && (
                  <div>
                    <label className="lbl">Kit incompleto: quem assume e por quê</label>
                    <textarea name="assumir_falta" className="inp" rows={3} required placeholder="Ex.: pneus chegam no PC 88 antes da montagem; Compras confirmou." />
                  </div>
                )}
                <button className="btn-pri w-full">{kit.completo ? "Liberar OP" : "Liberar assumindo a falta"}</button>
                <p className="text-xs text-apagado">Ao liberar, a OP entra na fila dos setores e é enviada ao Omie.</p>
              </form>
            </Card>
          )}
          {aberta && podePlanejar && (
            <Card titulo="Prioridade e promessa">
              <form action={prioridadeAction} className="space-y-3">
                <input type="hidden" name="op_id" value={op.id as number} />
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="lbl">Prioridade (maior = antes)</label><input type="number" name="prioridade" defaultValue={op.prioridade as number} className="inp" /></div>
                  <div><label className="lbl">Data prometida</label><input type="date" name="data_necessidade" defaultValue={op.data_necessidade as string} className="inp" /></div>
                </div>
                <button className="btn-sec w-full">Salvar e reprogramar</button>
              </form>
            </Card>
          )}
          {aberta && podePlanejar && (
            <Card titulo="Cancelar OP">
              <form action={cancelarAction} className="space-y-2">
                <input type="hidden" name="op_id" value={op.id as number} />
                <input name="motivo" className="inp" placeholder="Motivo do cancelamento" required />
                <button className="btn-perigo w-full">Cancelar OP</button>
              </form>
            </Card>
          )}
          <Card titulo="Omie">
            {envios.length === 0 ? (
              <p className="text-sm text-apagado">{op.status === "firmada" || op.status === "sugerida" ? "Será enviada ao Omie quando for liberada." : "Nenhum envio registrado."}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {envios.map((e) => (
                  <li key={e.tipo as string}>
                    <b>{(e.tipo as string).replace("_", " ")}</b>: {e.status as string}
                    {e.ultimo_erro && <div className="text-xs text-atencao">{e.ultimo_erro as string}</div>}
                  </li>
                ))}
              </ul>
            )}
            {op.omie_id && <p className="mt-2 text-xs text-apagado">nCodOP no Omie: {op.omie_id as number}</p>}
          </Card>
        </div>
      </div>

      <Card titulo={`Etapas (${tarefas.filter((t) => t.status === "concluida").length}/${tarefas.length} concluídas)`} className="mt-4" corpo="p-0">
        {tarefas.length === 0 ? (
          <Vazio>Nenhuma etapa: cadastre o roteiro dos itens e use "Recalcular estrutura".</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Componente</th><th>Operação</th><th>Setor</th><th className="num">Qtd</th><th className="num">Padrão</th><th className="num">Realizado</th><th>Status</th><th>Previsto</th><th>Aguarda</th></tr></thead>
              <tbody>
                {tarefas.map((t) => (
                  <tr key={t.id as number}>
                    <td style={{ paddingLeft: `${12 + (3 - Math.min(3, t.nivel as number)) * 0}px` }}>
                      <span className="font-mono text-xs">{t.codigo as string}</span>
                      <div className="max-w-64 truncate text-xs text-apagado">{t.item_descricao as string}</div>
                    </td>
                    <td className="text-xs">{t.descricao as string}</td>
                    <td className="whitespace-nowrap text-xs">{t.setor as string}</td>
                    <td className="num">{fmtQtd(t.quantidade as number)}{Number(t.qtd_refugo) > 0 && <div className="text-[11px] text-alerta">{fmtQtd(t.qtd_refugo as number)} refugo</div>}</td>
                    <td className="num text-xs">{fmtMin(t.tempo_previsto_min as number)}</td>
                    <td className={`num text-xs ${Number(t.realizado_min) > Number(t.tempo_previsto_min) * 1.2 ? "text-alerta" : ""}`}>{Number(t.realizado_min) ? fmtMin(t.realizado_min as number) : "–"}</td>
                    <td><StatusTarefa s={t.status as string} /></td>
                    <td className="whitespace-nowrap text-xs">{t.status === "concluida" ? `✓ ${fmtDataHora(t.concluida_em as Date)}` : `${fmtDataHora(t.inicio_previsto as Date)} → ${fmtDataHora(t.fim_previsto as Date)}`}</td>
                    <td className="max-w-48 text-xs text-apagado">{t.status === "pendente" ? (t.aguardando as string) ?? "pronta" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card titulo="Histórico" className="mt-4" corpo="p-0">
        <ul className="divide-y divide-linha text-sm">
          {historico.map((h) => (
            <li key={h.id as number} className="flex gap-3 px-4 py-2">
              <span className="w-28 shrink-0 text-xs text-apagado">{fmtDataHora(h.created_at as Date)}</span>
              <span className="font-medium">{h.acao as string}</span>
              <span className="text-apagado">{(h.nome as string) ?? "sistema"}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function Info({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="card px-4 py-3">
      <div className="coord">{rotulo}</div>
      <div className="mt-1 text-sm font-medium">{children}</div>
    </div>
  );
}
