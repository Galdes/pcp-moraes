import Link from "next/link";
import { Cabecalho, Card } from "@/components/ui";
import { checagens } from "@/server/qualidade";
import { exigir, ESCRITORIO } from "@/server/auth";
import { TIPO_ITEM } from "@/lib/formato";

export const dynamic = "force-dynamic";
export const metadata = { title: "Qualidade dos dados" };

export default async function Qualidade() {
  await exigir(...ESCRITORIO);
  const c = await checagens();
  const blocos: { titulo: string; porque: string; itens: Record<string, unknown>[]; grave?: boolean }[] = [
    { titulo: "Estrutura circular", porque: "Um item que contém a si mesmo trava a explosão e o MRP.", itens: c.ciclos.map((x) => ({ codigo: x, descricao: "" })), grave: true },
    { titulo: "Fabricados sem roteiro", porque: "Não geram etapas: o tempo não entra na programação nem na carga.", itens: c.semRoteiro, grave: true },
    { titulo: "Produtos e conjuntos sem estrutura", porque: "O kit sai vazio e o MRP não compra nada para eles.", itens: c.semEstrutura, grave: true },
    { titulo: "Supermercado sem mínimo/máximo", porque: "Sem limites o MRP não sabe quando repor.", itens: c.supermercadoSemLimites },
    { titulo: "Comprados com lead time zero", porque: "O MRP pede a compra na mesma semana da necessidade: vai faltar.", itens: c.semLeadTime },
    { titulo: "Importados do Omie para revisar", porque: "Tipo/origem/política foram deduzidos; confirme.", itens: c.revisar },
    { titulo: "Sem vínculo com o Omie", porque: "OP e requisição destes itens não podem ser enviadas ao Omie.", itens: c.semOmie },
    { titulo: "Estrutura manual em item do Omie", porque: "O dono da estrutura é o Omie: acerte lá para não divergir.", itens: c.estruturaManual.map((e) => ({ codigo: `${e.pai} → ${e.filho}`, descricao: "" })) },
  ];
  const graves = blocos.filter((b) => b.grave).reduce((a, b) => a + b.itens.length, 0);
  return (
    <>
      <Cabecalho coord="Engenharia" titulo="Qualidade dos dados" sub="Estrutura e roteiro errados são a causa nº 2 de fracasso de PCP. Zere os itens críticos antes de confiar no MRP e na programação." />
      <div className={`mb-4 rounded-md px-4 py-3 text-sm ${graves ? "border border-alerta/30 bg-alerta/5 text-alerta" : "border border-ok/30 bg-ok/5 text-ok"}`}>
        {graves ? `${graves} pendência(s) crítica(s) de cadastro.` : "Nenhuma pendência crítica de cadastro."}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {blocos.map((b) => (
          <Card key={b.titulo} titulo={<>{b.titulo} <span className={`badge ml-1 ${b.itens.length ? (b.grave ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800") : "bg-emerald-100 text-emerald-800"}`}>{b.itens.length}</span></>} corpo="p-0">
            <p className="px-4 py-2 text-xs text-apagado">{b.porque}</p>
            {b.itens.length > 0 && (
              <ul className="max-h-56 divide-y divide-linha overflow-auto border-t border-linha text-sm">
                {b.itens.slice(0, 100).map((i, k) => (
                  <li key={k} className="px-4 py-1.5">
                    {i.id ? <Link href={`/cadastros/itens/${i.id}`} className="font-mono text-xs hover:underline">{i.codigo as string}</Link> : <span className="font-mono text-xs">{i.codigo as string}</span>}
                    <span className="ml-2 text-xs text-apagado">{i.descricao as string}{i.tipo ? ` · ${TIPO_ITEM[i.tipo as string]}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}
