import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { headers } from "next/headers";
import { sql } from "@/lib/db";
import { exigir, ESCRITORIO } from "@/server/auth";
import { fmtData, fmtDataHora, fmtMin, fmtQtd } from "@/lib/formato";
import { BotaoImprimir } from "@/components/BotaoImprimir";

export const dynamic = "force-dynamic";

// Ficha no espírito do "Kanban Linha UV": uma folha por setor, com a
// sequência das operações, as peças e um QR que abre a tarefa no tablet.
export default async function Ficha({ params }: { params: Promise<{ id: string }> }) {
  await exigir(...ESCRITORIO);
  const { id } = await params;
  const [op] = await sql`
    select o.*, i.codigo, i.descricao, pv.numero as pedido, pv.cliente from ordens_producao o join itens i on i.id = o.item_id
    left join pedido_itens pi on pi.id = o.pedido_item_id left join pedidos_venda pv on pv.id = pi.pedido_id where o.id = ${Number(id) || 0}`;
  if (!op) notFound();
  const tarefas = await sql`
    select t.*, i.codigo, i.descricao as item_descricao, s.nome as setor, s.sequencia as setor_seq
    from tarefas t join itens i on i.id = t.item_id join setores s on s.id = t.setor_id
    where t.op_id = ${op.id} order by s.sequencia, t.inicio_previsto nulls last, t.nivel desc, i.codigo`;
  const h = await headers();
  const base = process.env.URL_PUBLICA ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const qrs = new Map<number, string>();
  for (const t of tarefas) qrs.set(t.id as number, await QRCode.toString(`${base}/posto?tarefa=${t.id}`, { type: "svg", margin: 0, width: 64 }));
  const porSetor = new Map<string, typeof tarefas>();
  for (const t of tarefas) porSetor.set(t.setor as string, [...(porSetor.get(t.setor as string) ?? []), t] as typeof tarefas);

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-4 flex justify-end"><BotaoImprimir /></div>
      {[...porSetor.entries()].map(([setor, lista]) => (
        <section key={setor} className="card mb-6 break-after-page p-6 print:mb-0 print:border-0">
          <div className="flex items-start justify-between border-b-2 border-tinta pb-3">
            <div>
              <div className="coord">Ficha de produção · Moraes Equipamentos</div>
              <h1 className="text-2xl font-bold">OP {op.numero as number} · {setor}</h1>
              <div className="text-sm"><span className="font-mono">{op.codigo as string}</span> {op.descricao as string} · Qtd {fmtQtd(op.quantidade as number)}</div>
            </div>
            <div className="text-right text-sm">
              <div>Promessa: <b>{fmtData(op.data_necessidade as string)}</b></div>
              {op.pedido && <div>Pedido {op.pedido as string}</div>}
              <div className="text-xs text-apagado">Emitida em {fmtDataHora(new Date())}</div>
            </div>
          </div>
          <table className="tbl mt-3">
            <thead><tr><th>#</th><th>Peça / conjunto</th><th>Operação</th><th className="num">Qtd</th><th className="num">Tempo</th><th>Previsto</th><th>QR</th></tr></thead>
            <tbody>
              {lista.map((t, i) => (
                <tr key={t.id as number}>
                  <td className="font-semibold">{i + 1}</td>
                  <td><span className="font-mono text-xs">{t.codigo as string}</span><div className="text-xs">{t.item_descricao as string}</div></td>
                  <td className="text-xs">{t.descricao as string}</td>
                  <td className="num text-base font-semibold">{fmtQtd(t.quantidade as number)}</td>
                  <td className="num text-xs">{fmtMin(t.tempo_previsto_min as number)}</td>
                  <td className="text-xs">{t.status === "concluida" ? "concluída" : fmtDataHora(t.inicio_previsto as Date)}</td>
                  <td><div className="h-16 w-16" dangerouslySetInnerHTML={{ __html: qrs.get(t.id as number)! }} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-apagado">Leia o QR no tablet do setor para iniciar, parar ou concluir a etapa. Não risque a ficha: o apontamento é no tablet.</p>
        </section>
      ))}
    </div>
  );
}
