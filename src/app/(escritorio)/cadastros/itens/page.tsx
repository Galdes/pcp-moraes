import Link from "next/link";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, Vazio } from "@/components/ui";
import { CamposItem } from "@/components/CamposItem";
import { exigir, ESCRITORIO } from "@/server/auth";
import { fmtQtd, TIPO_ITEM } from "@/lib/formato";
import { novoItemAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Itens e estruturas" };

export default async function Itens({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const tipo = sp.tipo ?? "";
  const itens = await sql`
    select i.*, s.quantidade as saldo, s.fonte as saldo_fonte,
      (select count(*) from estrutura e where e.pai_id = i.id)::int as n_comp,
      (select count(*) from roteiros r where r.item_id = i.id)::int as n_ops
    from itens i left join estoque_saldos s on s.item_id = i.id
    where (${q} = '' or i.codigo ilike ${"%" + q + "%"} or i.descricao ilike ${"%" + q + "%"})
      and (${tipo} = '' or i.tipo::text = ${tipo})
    order by i.tipo, i.codigo limit 500`;
  return (
    <>
      <Cabecalho coord="Engenharia" titulo="Itens e estruturas" sub="Produtos, conjuntos e peças vêm do Omie; aqui o PCP completa o que o Omie não tem: roteiro, tempos, política de supermercado, lotes e lead time." />
      <Aviso busca={sp} />
      <form className="mb-3 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Código ou descrição" className="inp w-64" />
        <select name="tipo" defaultValue={tipo} className="inp w-48">
          <option value="">Todos os tipos</option>
          {Object.entries(TIPO_ITEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="btn-sec">Filtrar</button>
      </form>
      <Card corpo="p-0">
        {itens.length === 0 ? <Vazio>Nenhum item.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th>Origem / política</th><th className="num">Saldo</th><th className="num">Lead time</th><th className="num">Componentes</th><th className="num">Operações</th><th>Omie</th></tr></thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.id as number} className={`hover:bg-carta/50 ${i.ativo ? "" : "opacity-50"}`}>
                    <td><Link href={`/cadastros/itens/${i.id}`} className="font-mono text-xs font-semibold hover:underline">{i.codigo as string}</Link>{i.revisar && <span className="badge ml-1 bg-amber-100 text-amber-800">revisar</span>}</td>
                    <td className="text-xs">{i.descricao as string}</td>
                    <td className="text-xs">{TIPO_ITEM[i.tipo as string]}</td>
                    <td className="text-xs">{i.origem as string}{i.origem === "fabricado" && ` · ${i.politica === "supermercado" ? "supermercado" : "sob pedido"}`}</td>
                    <td className="num text-xs">{i.saldo === null ? "–" : `${fmtQtd(i.saldo as number)} ${i.unidade}`}</td>
                    <td className="num text-xs">{i.lead_time_dias as number} d</td>
                    <td className="num text-xs">{i.n_comp as number || "–"}</td>
                    <td className={`num text-xs ${i.origem === "fabricado" && !i.n_ops ? "font-semibold text-alerta" : ""}`}>{i.origem === "fabricado" ? i.n_ops as number : "–"}</td>
                    <td className="text-xs">{i.omie_id ? "vinculado" : <span className="text-apagado">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card titulo="Novo item (use só para itens que ainda não existem no Omie)" className="mt-4">
        <form action={novoItemAction} className="space-y-3">
          <CamposItem comCodigo />
          <button className="btn-pri">Criar item</button>
        </form>
      </Card>
    </>
  );
}
