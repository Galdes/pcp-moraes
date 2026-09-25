import Link from "next/link";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, Vazio } from "@/components/ui";
import { exigir, ESCRITORIO } from "@/server/auth";
import { ultimaExecucao } from "@/server/mrp";
import { fmtData, fmtDataHora, fmtQtd, TIPO_ITEM } from "@/lib/formato";
import { hojeNoFuso, somarDias } from "@/domain/datas";
import { converterAction, requisicaoAction, rodarMRPAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "MRP e compras" };

export default async function MRP({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const ex = await ultimaExecucao();
  const sugestoes = ex
    ? await sql`select s.*, i.codigo, i.descricao, i.unidade, i.politica, i.tipo as item_tipo, i.lead_time_dias, o.numero as op_numero
                from sugestoes s join itens i on i.id = s.item_id left join ordens_producao o on o.id = s.op_id
                where s.execucao_id = ${ex.id} order by s.tipo, s.atrasada desc, s.data_liberacao, i.codigo`
    : [];
  const itensGrade = ex ? await sql`select distinct l.item_id, i.codigo, i.descricao from mrp_linhas l join itens i on i.id = l.item_id where l.execucao_id = ${ex.id} order by i.codigo` : [];
  const itemSel = Number(sp.item) || (sugestoes.find((s) => s.tipo === "compra")?.item_id as number) || (itensGrade[0]?.item_id as number);
  const grade = ex && itemSel ? await sql`select * from mrp_linhas where execucao_id = ${ex.id} and item_id = ${itemSel} order by semana` : [];
  const [itemInfo] = itemSel ? await sql`select codigo, descricao, unidade, lead_time_dias, estoque_seguranca, estoque_min, estoque_max, lote_minimo, lote_multiplo, politica from itens where id = ${itemSel}` : [];
  const compras = sugestoes.filter((s) => s.tipo === "compra");
  const producao = sugestoes.filter((s) => s.tipo === "producao");
  const avisos = (ex?.avisos as string[]) ?? [];
  const hoje = hojeNoFuso();
  // balde 0 começa na segunda desta semana: data já passada vira "esta semana"
  const quando = (d: string) => (d < hoje ? "esta semana" : fmtData(d));

  return (
    <>
      <Cabecalho coord="Planejar" titulo="MRP e compras" sub="Necessidade de materiais em baldes semanais: pedidos + OPs abertas + supermercado, contra saldo e compras em aberto do Omie." acoes={<form action={rodarMRPAction}><button className="btn-pri">Calcular MRP agora</button></form>} />
      <Aviso busca={sp} />
      {!ex ? (
        <Card><Vazio>O MRP ainda não foi calculado. Clique em “Calcular MRP agora”.</Vazio></Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-apagado">
            Última execução: {fmtDataHora(ex.executado_em as Date)} por {(ex.executado_por_nome as string) ?? "agendamento"} · horizonte de {ex.horizonte_semanas as number} semanas a partir de {fmtData(ex.semana_inicial as string)}.
          </p>
          {avisos.length > 0 && (
            <div className="mb-4 rounded-md border border-atencao/40 bg-atencao/5 px-4 py-2 text-sm">
              {avisos.map((a) => <div key={a}>{a}</div>)}
            </div>
          )}
          <div className="grid gap-4 xl:grid-cols-2">
            <Card titulo={`Sugestões de compra (${compras.length})`} corpo="p-0">
              {compras.length === 0 ? <Vazio>Nada a comprar no horizonte.</Vazio> : (
                <form action={requisicaoAction}>
                  <div className="max-h-[480px] overflow-auto">
                    <table className="tbl">
                      <thead><tr><th></th><th>Item</th><th className="num">Qtd</th><th>Pedir até</th><th>Precisa em</th><th>Situação</th></tr></thead>
                      <tbody>
                        {compras.map((s) => (
                          <tr key={s.id as number} className={s.atrasada ? "bg-red-50/60" : ""}>
                            <td>{s.status === "aberta" && <input type="checkbox" name="sugestao" value={s.id as number} defaultChecked className="h-4 w-4" />}</td>
                            <td><Link href={`/mrp?item=${s.item_id}`} className="font-mono text-xs hover:underline">{s.codigo as string}</Link><div className="text-xs text-apagado">{s.descricao as string}</div></td>
                            <td className="num">{fmtQtd(s.quantidade as number)} {s.unidade as string}</td>
                            <td className={`whitespace-nowrap ${s.atrasada ? "font-semibold text-alerta" : ""}`}>{s.atrasada ? "já!" : quando(s.data_liberacao as string)}</td>
                            <td className="whitespace-nowrap">{quando(s.data_necessidade as string)}</td>
                            <td className="text-xs">{s.status === "aberta" ? "aberta" : s.status === "convertida" ? "requisitada" : "descartada"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {compras.some((s) => s.status === "aberta") && (
                    <div className="flex items-center justify-between border-t border-linha px-4 py-3">
                      <span className="text-xs text-apagado">A requisição vai para o Omie; o comprador escolhe fornecedor e converte em pedido lá.</span>
                      <button className="btn-pri">Gerar requisição de compra</button>
                    </div>
                  )}
                </form>
              )}
            </Card>
            <Card titulo={`Sugestões de produção (${producao.length})`} corpo="p-0">
              {producao.length === 0 ? <Vazio>Nenhuma OP sugerida.</Vazio> : (
                <div className="max-h-[520px] overflow-auto">
                  <table className="tbl">
                    <thead><tr><th>Item</th><th className="num">Qtd</th><th>Liberar em</th><th>Precisa em</th><th></th></tr></thead>
                    <tbody>
                      {producao.map((s) => (
                        <tr key={s.id as number} className={s.atrasada ? "bg-red-50/60" : ""}>
                          <td>
                            <Link href={`/mrp?item=${s.item_id}`} className="font-mono text-xs hover:underline">{s.codigo as string}</Link>
                            <div className="text-xs text-apagado">{s.descricao as string}</div>
                            <span className={`badge ${s.politica === "supermercado" ? "bg-latao/20 text-latao-escuro" : "bg-slate-100 text-slate-600"}`}>{s.politica === "supermercado" ? "reposição supermercado" : TIPO_ITEM[s.item_tipo as string]}</span>
                          </td>
                          <td className="num">{fmtQtd(s.quantidade as number)}</td>
                          <td className={`whitespace-nowrap ${s.atrasada ? "font-semibold text-alerta" : ""}`}>{s.atrasada ? "já!" : quando(s.data_liberacao as string)}</td>
                          <td className="whitespace-nowrap">{quando(s.data_necessidade as string)}</td>
                          <td className="text-right">
                            {s.status === "aberta" ? (
                              <form action={converterAction}><input type="hidden" name="sugestao_id" value={s.id as number} /><button className="btn-sec btn-xs">Criar OP</button></form>
                            ) : s.op_id ? <Link href={`/ops/${s.op_id}`} className="text-xs underline">OP {s.op_numero as number}</Link> : <span className="text-xs text-apagado">{s.status as string}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>

          <Card titulo="Grade do MRP por item" className="mt-4" corpo="p-0" acoes={
            <form className="flex gap-2">
              <select name="item" defaultValue={itemSel} className="inp w-80">
                {itensGrade.map((i) => <option key={i.item_id as number} value={i.item_id as number}>{i.codigo} · {i.descricao}</option>)}
              </select>
              <button className="btn-sec">Ver</button>
            </form>
          }>
            {itemInfo && (
              <p className="border-b border-linha px-4 py-2 text-xs text-apagado">
                <b className="font-mono text-tinta">{itemInfo.codigo as string}</b> {itemInfo.descricao as string} · lead time {itemInfo.lead_time_dias as number} dias ·{" "}
                {itemInfo.politica === "supermercado" ? `supermercado mín ${fmtQtd(itemInfo.estoque_min as number)} / máx ${fmtQtd(itemInfo.estoque_max as number)}` : `estoque de segurança ${fmtQtd(itemInfo.estoque_seguranca as number)}`}
                {Number(itemInfo.lote_minimo) > 0 && ` · lote mínimo ${fmtQtd(itemInfo.lote_minimo as number)}`}
                {Number(itemInfo.lote_multiplo) > 0 && ` · múltiplo ${fmtQtd(itemInfo.lote_multiplo as number)}`}
              </p>
            )}
            {grade.length === 0 ? <Vazio>Sem movimento para este item.</Vazio> : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead>
                    <tr><th>Semana</th>{grade.map((g) => <th key={g.semana as number} className="num">{g.semana === 0 ? "Atual" : fmtData(somarDias(ex.semana_inicial as string, 7 * (g.semana as number))).slice(0, 5)}</th>)}</tr>
                  </thead>
                  <tbody>
                    {([["bruta", "Necessidade bruta"], ["recebimentos", "Recebimentos programados"], ["estoque_projetado", "Estoque projetado"], ["liquida", "Necessidade líquida"], ["recebimento_planejado", "Recebimento planejado"], ["liberacao_planejada", "Liberação planejada"]] as const).map(([k, rot]) => (
                      <tr key={k} className={k === "liberacao_planejada" ? "bg-latao/10 font-semibold" : ""}>
                        <td className="whitespace-nowrap text-xs">{rot}</td>
                        {grade.map((g) => {
                          const v = Number(g[k]);
                          return <td key={g.semana as number} className={`num ${k === "estoque_projetado" && v < 0 ? "text-alerta" : ""} ${!v ? "text-apagado/50" : ""}`}>{v ? fmtQtd(v) : "·"}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </>
  );
}
