import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card } from "@/components/ui";
import { exigir, ESCRITORIO } from "@/server/auth";
import { alternarMotivoAction, salvarMotivoAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Motivos de parada" };

const TIPOS: Record<string, string> = { planejada: "Planejada (fora do OEE)", setup: "Setup", quebra: "Quebra / manutenção", falta_material: "Falta de material", qualidade: "Qualidade", organizacional: "Organizacional" };

export default async function Motivos({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const paradas = await sql`select * from motivos_parada order by codigo`;
  const refugos = await sql`select * from motivos_refugo order by codigo`;
  return (
    <>
      <Cabecalho coord="Engenharia" titulo="Motivos de parada e refugo" sub="Poucos motivos, bem definidos: o operador escolhe em um toque e o Pareto fica confiável. Códigos no padrão da planilha de OEE (100 planejadas, 200 setup, 300 quebras...)." />
      <Aviso busca={sp} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card titulo="Paradas" corpo="p-0">
          <table className="tbl">
            <thead><tr><th>Código</th><th>Descrição</th><th>Tipo</th><th></th></tr></thead>
            <tbody>
              {paradas.map((m) => (
                <tr key={m.id as number} className={m.ativo ? "" : "opacity-40"}>
                  <td className="font-mono">{m.codigo as string}</td><td>{m.descricao as string}</td><td className="text-xs">{TIPOS[m.tipo as string]}</td>
                  <td><form action={alternarMotivoAction}><input type="hidden" name="tabela" value="parada" /><input type="hidden" name="id" value={m.id as number} /><button className="btn-sec btn-xs">{m.ativo ? "desativar" : "ativar"}</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={salvarMotivoAction} className="grid grid-cols-[70px_1fr_170px_auto] gap-2 border-t border-linha p-3">
            <input type="hidden" name="tabela" value="parada" />
            <input name="codigo" className="inp font-mono" placeholder="cód." required />
            <input name="descricao" className="inp" placeholder="descrição" required />
            <select name="tipo" className="inp">{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn-pri">Salvar</button>
          </form>
        </Card>
        <Card titulo="Refugo" corpo="p-0">
          <table className="tbl">
            <thead><tr><th>Código</th><th>Descrição</th><th></th></tr></thead>
            <tbody>
              {refugos.map((m) => (
                <tr key={m.id as number} className={m.ativo ? "" : "opacity-40"}>
                  <td className="font-mono">{m.codigo as string}</td><td>{m.descricao as string}</td>
                  <td><form action={alternarMotivoAction}><input type="hidden" name="tabela" value="refugo" /><input type="hidden" name="id" value={m.id as number} /><button className="btn-sec btn-xs">{m.ativo ? "desativar" : "ativar"}</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
          <form action={salvarMotivoAction} className="grid grid-cols-[70px_1fr_auto] gap-2 border-t border-linha p-3">
            <input type="hidden" name="tabela" value="refugo" />
            <input name="codigo" className="inp font-mono" placeholder="cód." required />
            <input name="descricao" className="inp" placeholder="descrição" required />
            <button className="btn-pri">Salvar</button>
          </form>
        </Card>
      </div>
    </>
  );
}
