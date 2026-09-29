import Link from "next/link";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, StatusOP, Vazio } from "@/components/ui";
import { fmtData, fmtQtd } from "@/lib/formato";
import { hojeNoFuso, somarDias, diferencaDias } from "@/domain/datas";
import { exigir, ESCRITORIO } from "@/server/auth";
import { gerarOPAction, novoPedidoAction, statusPedidoAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pedidos de venda" };

export default async function Pedidos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const status = sp.status === "todos" ? null : "aberto";
  const hoje = hojeNoFuso();
  const linhas = await sql`
    select p.id as pedido_id, p.numero, p.cliente, p.data_entrega, p.status, p.omie_id, pi.id as pedido_item_id, pi.quantidade,
      i.codigo, i.descricao, i.lead_time_dias, i.origem,
      coalesce((select sum(o.quantidade) from ordens_producao o where o.pedido_item_id = pi.id and o.status <> 'cancelada'), 0) as coberto,
      (select json_agg(json_build_object('id', o.id, 'numero', o.numero, 'status', o.status, 'fim', o.fim_previsto) order by o.numero)
        from ordens_producao o where o.pedido_item_id = pi.id and o.status <> 'cancelada') as ops
    from pedidos_venda p join pedido_itens pi on pi.pedido_id = p.id join itens i on i.id = pi.item_id
    where (${status}::text is null or p.status = ${status})
    order by p.data_entrega, p.numero`;
  const produtos = await sql`select id, codigo, descricao from itens where ativo and origem = 'fabricado' order by codigo`;
  return (
    <>
      <Cabecalho coord="Planejar" titulo="Pedidos de venda" sub="Carteira sincronizada do Omie. Itens fabricados podem gerar OPs vinculadas ao pedido; itens comprados exigem estoque ou compras." acoes={
        <>
          <Link href="/pedidos" className={status ? "btn-pri btn-xs" : "btn-sec btn-xs"}>Em aberto</Link>
          <Link href="/pedidos?status=todos" className={!status ? "btn-pri btn-xs" : "btn-sec btn-xs"}>Todos</Link>
        </>
      } />
      <Aviso busca={sp} />
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card corpo="p-0">
          {linhas.length === 0 ? <Vazio>Nenhum pedido neste filtro.</Vazio> : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead><tr><th>Pedido</th><th>Cliente</th><th>Item fabricado</th><th className="num">Qtd</th><th>Entrega</th><th>OPs</th><th></th></tr></thead>
                <tbody>
                  {linhas.map((l) => {
                    const falta = Number(l.quantidade) - Number(l.coberto);
                    const dias = diferencaDias(l.data_entrega as string, hoje);
                    const apertado = falta > 0 && dias < (l.lead_time_dias as number);
                    const ops = (l.ops as { id: number; numero: number; status: string; fim: string | null }[] | null) ?? [];
                    return (
                      <tr key={l.pedido_item_id as number}>
                        <td className="font-semibold">{l.numero as string}{!l.omie_id && <div className="text-[10px] font-normal text-apagado">manual</div>}</td>
                        <td className="text-xs">{l.cliente as string}</td>
                        <td><span className="font-mono text-xs">{l.codigo as string}</span><div className="max-w-72 truncate text-xs text-apagado">{l.descricao as string}</div></td>
                        <td className="num">{fmtQtd(l.quantidade as number)}</td>
                        <td className="whitespace-nowrap">{fmtData(l.data_entrega as string)}<div className={`text-[11px] ${dias < 0 ? "text-alerta" : "text-apagado"}`}>{dias < 0 ? `${-dias} dias atrás` : `em ${dias} dias`}</div></td>
                        <td className="space-y-1">
                          {ops.map((o) => (
                            <Link key={o.id} href={`/ops/${o.id}`} className="flex items-center gap-1.5 text-xs hover:underline">
                              <b>{o.numero}</b> <StatusOP s={o.status} />
                            </Link>
                          ))}
                        </td>
                        <td className="text-right">
                          {falta > 0 && l.status === "aberto" && l.origem === "fabricado" && (
                            <form action={gerarOPAction}>
                              <input type="hidden" name="pedido_item_id" value={l.pedido_item_id as number} />
                              <button className="btn-pri btn-xs">Gerar OP ({fmtQtd(falta)})</button>
                              {apertado && <div className="mt-1 text-[10px] text-alerta">prazo menor que o lead time ({l.lead_time_dias as number} d)</div>}
                            </form>
                          )}
                          {!l.omie_id && l.status === "aberto" && falta <= 0 && (
                            <form action={statusPedidoAction}>
                              <input type="hidden" name="pedido_id" value={l.pedido_id as number} />
                              <input type="hidden" name="status" value="atendido" />
                              <button className="btn-sec btn-xs">Marcar atendido</button>
                            </form>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card titulo="Pedido manual">
          <form action={novoPedidoAction} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div><label className="lbl">Número</label><input name="numero" className="inp" required /></div>
              <div><label className="lbl">Quantidade</label><input name="quantidade" className="inp" defaultValue="1" required /></div>
            </div>
            <div><label className="lbl">Cliente</label><input name="cliente" className="inp" required /></div>
            <div>
              <label className="lbl">Item fabricado</label>
              <select name="item_id" className="inp" required defaultValue="">
                <option value="" disabled>Escolha...</option>
                {produtos.map((p) => <option key={p.id as number} value={p.id as number}>{p.codigo} · {p.descricao}</option>)}
              </select>
            </div>
            <div><label className="lbl">Data de entrega prometida</label><input type="date" name="data_entrega" className="inp" defaultValue={somarDias(hoje, 30)} required /></div>
            <button className="btn-sec w-full">Cadastrar</button>
            <p className="text-xs text-apagado">Use só enquanto a sincronização com o Omie não estiver ativa. Depois, os pedidos vêm do Omie.</p>
          </form>
        </Card>
      </div>
    </>
  );
}
