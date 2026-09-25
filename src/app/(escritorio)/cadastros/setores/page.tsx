import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, Vazio } from "@/components/ui";
import { exigir, ESCRITORIO } from "@/server/auth";
import { fmtData, fmtMin } from "@/lib/formato";
import { hojeNoFuso } from "@/domain/datas";
import { addIndisponibilidadeAction, excecaoCalendarioAction, removerIndisponibilidadeAction, salvarSetorAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Setores e capacidade" };

export default async function Setores({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const setores = await sql`select * from setores order by sequencia`;
  const indisp = await sql`select i.*, s.nome from indisponibilidades i join setores s on s.id = i.setor_id where i.fim >= ${hojeNoFuso()} order by i.inicio`;
  const excecoes = await sql`select * from calendario_excecoes where data >= ${hojeNoFuso()} order by data`;
  return (
    <>
      <Cabecalho coord="Engenharia" titulo="Setores e capacidade" sub="Capacidade diária de um setor = recursos × horas do turno × eficiência. Recursos são pessoas/postos que trabalham em paralelo." />
      <Aviso busca={sp} />
      <Card corpo="p-0">
        <div className="grid grid-cols-[70px_110px_1fr_70px_80px_80px_80px_80px_auto] gap-2 border-b border-linha bg-carta/60 px-3 py-2 text-xs font-semibold uppercase text-apagado">
          <span>Seq</span><span>Código</span><span>Nome</span><span>Recursos</span><span>Horas/dia</span><span>Efic. %</span><span>Gargalo</span><span>Ativo</span><span />
        </div>
        {[...setores, null].map((s) => (
          <form key={(s?.id as number) ?? "novo"} action={salvarSetorAction} className={`grid grid-cols-[70px_110px_1fr_70px_80px_80px_80px_80px_auto] items-center gap-2 border-b border-linha px-3 py-2 ${s ? "" : "bg-carta/40"}`}>
            <input type="hidden" name="id" value={(s?.id as number) ?? ""} />
            <input name="sequencia" defaultValue={(s?.sequencia as number) ?? ""} className="inp" />
            <input name="codigo" defaultValue={(s?.codigo as string) ?? ""} className="inp font-mono" placeholder="NOVO" />
            <div>
              <input name="nome" defaultValue={(s?.nome as string) ?? ""} className="inp" placeholder="Nome do novo setor" />
              {s && <div className="mt-0.5 text-[11px] text-apagado">capacidade {fmtMin(Number(s.recursos) * Number(s.horas_turno) * 60 * Number(s.eficiencia))}/dia</div>}
            </div>
            <input name="recursos" defaultValue={(s?.recursos as number) ?? 1} className="inp" />
            <input name="horas_turno" defaultValue={(s?.horas_turno as number) ?? 8.8} className="inp" />
            <input name="eficiencia" defaultValue={s ? Math.round(Number(s.eficiencia) * 100) : 85} className="inp" />
            <input type="checkbox" name="eh_gargalo" defaultChecked={!!s?.eh_gargalo} className="h-4 w-4" />
            <input type="checkbox" name="ativo" defaultChecked={s ? (s.ativo as boolean) : true} className="h-4 w-4" />
            <button className={s ? "btn-sec btn-xs" : "btn-pri btn-xs"}>{s ? "salvar" : "incluir"}</button>
          </form>
        ))}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card titulo="Indisponibilidades (máquina parada, NR12, férias)" corpo="p-0">
          {indisp.length === 0 ? <Vazio>Nenhuma indisponibilidade futura.</Vazio> : (
            <table className="tbl">
              <thead><tr><th>Setor</th><th>Período</th><th className="num">Recursos</th><th>Motivo</th><th></th></tr></thead>
              <tbody>
                {indisp.map((i) => (
                  <tr key={i.id as number}>
                    <td>{i.nome as string}</td>
                    <td className="whitespace-nowrap text-xs">{fmtData(i.inicio as string)} a {fmtData(i.fim as string)}</td>
                    <td className="num">{i.recursos_indisponiveis as number}</td>
                    <td className="text-xs">{i.motivo as string}</td>
                    <td><form action={removerIndisponibilidadeAction}><input type="hidden" name="id" value={i.id as number} /><button className="btn-perigo btn-xs">remover</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={addIndisponibilidadeAction} className="grid grid-cols-2 gap-2 border-t border-linha p-3 sm:grid-cols-[1fr_130px_130px_70px]">
            <select name="setor_id" className="inp">{setores.map((s) => <option key={s.id as number} value={s.id as number}>{s.nome as string}</option>)}</select>
            <input type="date" name="inicio" className="inp" required />
            <input type="date" name="fim" className="inp" />
            <input name="recursos" defaultValue="1" className="inp" title="recursos indisponíveis" />
            <input name="motivo" className="inp sm:col-span-3" placeholder="Motivo (ex.: torno em adequação NR12)" required />
            <button className="btn-pri">Registrar</button>
          </form>
        </Card>
        <Card titulo="Calendário: feriados e dias extras" corpo="p-0">
          {excecoes.length === 0 ? <Vazio>Sem exceções futuras. Padrão: segunda a sexta.</Vazio> : (
            <table className="tbl">
              <tbody>
                {excecoes.map((e) => (
                  <tr key={e.data as string}>
                    <td>{fmtData(e.data as string)}</td>
                    <td>{Number(e.horas) === 0 ? <span className="badge bg-slate-100">não trabalha</span> : `${e.horas} h`}</td>
                    <td className="text-xs">{e.descricao as string}</td>
                    <td><form action={excecaoCalendarioAction}><input type="hidden" name="data" value={e.data as string} /><input type="hidden" name="remover" value="1" /><button className="btn-perigo btn-xs">remover</button></form></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form action={excecaoCalendarioAction} className="grid grid-cols-[130px_80px_1fr_auto] gap-2 border-t border-linha p-3">
            <input type="date" name="data" className="inp" required />
            <input name="horas" defaultValue="0" className="inp" title="horas trabalhadas no dia (0 = folga)" />
            <input name="descricao" className="inp" placeholder="Feriado, sábado trabalhado..." />
            <button className="btn-pri">Salvar</button>
          </form>
        </Card>
      </div>
    </>
  );
}
