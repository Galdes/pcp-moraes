import Link from "next/link";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, StatusOP, Vazio } from "@/components/ui";
import { fmtData, fmtDataHora, fmtQtd } from "@/lib/formato";
import { hojeNoFuso, somarDias } from "@/domain/datas";
import { novaOPAction } from "./actions";
import { exigir, ESCRITORIO } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ordens de produção" };

const FILTROS: Record<string, [string, string[]]> = {
  abertas: ["Abertas", ["sugerida", "firmada", "liberada", "em_processo"]],
  firmada: ["A liberar", ["firmada"]],
  execucao: ["Na fábrica", ["liberada", "em_processo"]],
  concluida: ["Concluídas", ["concluida"]],
  todas: ["Todas", ["sugerida", "firmada", "liberada", "em_processo", "concluida", "cancelada"]],
};

export default async function Ops({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const filtro = FILTROS[sp.status ?? "abertas"] ? sp.status ?? "abertas" : "abertas";
  const q = (sp.q ?? "").trim();
  const ops = await sql`
    select o.*, i.codigo, i.descricao, pv.numero as pedido, pv.cliente,
      (select count(*) from tarefas t where t.op_id = o.id)::int as n_tarefas,
      (select count(*) from tarefas t where t.op_id = o.id and t.status = 'concluida')::int as n_feitas,
      (select coalesce(sum(tempo_previsto_min), 0) from tarefas t where t.op_id = o.id) as min_total,
      (select coalesce(sum(tempo_previsto_min), 0) from tarefas t where t.op_id = o.id and t.status = 'concluida') as min_feitos
    from ordens_producao o join itens i on i.id = o.item_id
    left join pedido_itens pi on pi.id = o.pedido_item_id left join pedidos_venda pv on pv.id = pi.pedido_id
    where o.status = any(${FILTROS[filtro][1]}::status_op[])
      and (${q} = '' or i.codigo ilike ${"%" + q + "%"} or i.descricao ilike ${"%" + q + "%"} or o.numero::text = ${q} or coalesce(pv.numero, '') ilike ${"%" + q + "%"})
    order by case o.status when 'em_processo' then 0 when 'liberada' then 1 when 'firmada' then 2 when 'sugerida' then 3 else 4 end,
      o.prioridade desc, o.data_necessidade, o.numero desc
    limit 300`;
  const fabricados = await sql`select id, codigo, descricao from itens where ativo and origem = 'fabricado' and tipo in ('produto', 'conjunto', 'peca') order by tipo, codigo`;
  const hoje = hojeNoFuso();
  return (
    <>
      <Cabecalho coord="Planejar" titulo="Ordens de produção" sub="Toda necessidade vira OP: pedido de venda (sob encomenda), reposição de supermercado ou sugestão do MRP." />
      <Aviso busca={sp} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Object.entries(FILTROS).map(([k, [rot]]) => (
          <Link key={k} href={`/ops?status=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={k === filtro ? "btn-pri btn-xs" : "btn-sec btn-xs"}>{rot}</Link>
        ))}
        <form className="ml-auto flex gap-2">
          <input type="hidden" name="status" value={filtro} />
          <input name="q" defaultValue={q} placeholder="OP, código, pedido..." className="inp w-56" />
          <button className="btn-sec">Buscar</button>
        </form>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card corpo="p-0">
          {ops.length === 0 ? (
            <Vazio>Nenhuma OP neste filtro.</Vazio>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr><th>OP</th><th>Item</th><th className="num">Qtd</th><th>Origem</th><th>Status</th><th>Prometida</th><th>Fim previsto</th><th>Avanço</th></tr>
                </thead>
                <tbody>
                  {ops.map((o) => {
                    const pct = Number(o.min_total) ? Number(o.min_feitos) / Number(o.min_total) : 0;
                    const fim = o.fim_previsto ? new Date(o.fim_previsto as Date).toISOString().slice(0, 10) : null;
                    const risco = o.status !== "concluida" && o.status !== "cancelada" && ((o.data_necessidade as string) < hoje || (fim && fim > (o.data_necessidade as string)));
                    return (
                      <tr key={o.id as number} className="hover:bg-carta/50">
                        <td><Link href={`/ops/${o.id}`} className="font-semibold hover:underline">{o.numero}</Link>{(o.prioridade as number) > 0 && <span className="badge ml-1 bg-latao/25 text-latao-escuro">P{o.prioridade}</span>}</td>
                        <td><div className="font-mono text-xs">{o.codigo}</div><div className="max-w-80 truncate text-xs text-apagado">{o.descricao}</div></td>
                        <td className="num">{fmtQtd(o.quantidade as number)}</td>
                        <td className="text-xs">{o.origem === "pedido" ? <>Pedido {o.pedido}<div className="text-apagado">{o.cliente}</div></> : o.origem}</td>
                        <td><StatusOP s={o.status as string} /></td>
                        <td className="whitespace-nowrap">{fmtData(o.data_necessidade as string)}</td>
                        <td className={`whitespace-nowrap ${risco ? "font-semibold text-alerta" : ""}`}>{o.status === "concluida" ? `✓ ${fmtData(o.concluida_em as Date)}` : o.fim_previsto ? fmtDataHora(o.fim_previsto as Date) : "–"}</td>
                        <td className="w-36">
                          <div className="flex justify-between text-[11px] text-apagado"><span>{o.n_feitas}/{o.n_tarefas} etapas</span><span>{Math.round(pct * 100)}%</span></div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-linha/70"><div className="h-1.5 bg-processo" style={{ width: `${pct * 100}%` }} /></div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card titulo="Nova OP manual">
          <form action={novaOPAction} className="space-y-3">
            <div>
              <label className="lbl">Item fabricado</label>
              <select name="item_id" className="inp" required defaultValue="">
                <option value="" disabled>Escolha...</option>
                {fabricados.map((i) => <option key={i.id as number} value={i.id as number}>{i.codigo} · {i.descricao}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="lbl">Quantidade</label><input name="quantidade" className="inp" inputMode="decimal" required defaultValue="1" /></div>
              <div><label className="lbl">Prioridade</label><input name="prioridade" type="number" className="inp" defaultValue="0" /></div>
            </div>
            <div><label className="lbl">Data de necessidade</label><input name="data_necessidade" type="date" className="inp" required defaultValue={somarDias(hoje, 15)} /></div>
            <div><label className="lbl">Observação</label><input name="observacao" className="inp" /></div>
            <button className="btn-pri w-full">Criar OP firmada</button>
            <p className="text-xs text-apagado">Para pedidos de clientes, prefira gerar a OP pela tela de Pedidos: ela fica vinculada ao pedido e entra no OTD.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
