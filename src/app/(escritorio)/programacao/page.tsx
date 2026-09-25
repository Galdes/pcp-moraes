import Link from "next/link";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, StatusOP, StatusTarefa, Vazio } from "@/components/ui";
import { CargaCapacidade } from "@/components/Graficos";
import { cargaPorSetor, programaDaSemana } from "@/server/programacao";
import { exigir, ESCRITORIO, PODE_APROVAR, PODE_LIDERAR } from "@/server/auth";
import { hojeNoFuso, segundaDaSemana, somarDias, diferencaDias } from "@/domain/datas";
import { fmtData, fmtDataHora, fmtMin, fmtQtd } from "@/lib/formato";
import { aprovarAction, moverAction, reprogramarAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Programação" };

export default async function Programacao({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await exigir(...ESCRITORIO);
  const sp = await searchParams;
  const hoje = hojeNoFuso();
  const semana = segundaDaSemana(hoje);
  const { setores, carga } = await cargaPorSetor(6);
  const setorAtual = setores.find((s) => s.codigo === sp.setor) ?? setores[0];
  const fila = setorAtual
    ? await sql`
      select t.id, t.descricao, t.quantidade, t.tempo_previsto_min, t.status, t.fila_manual, t.inicio_previsto, t.fim_previsto,
        i.codigo, o.id as op_id, o.numero, o.status as op_status, o.data_necessidade, o.prioridade,
        not exists (select 1 from tarefa_dependencias d join tarefas p on p.id = d.depende_de_id where d.tarefa_id = t.id and p.status <> 'concluida') as pronta
      from tarefas t join ordens_producao o on o.id = t.op_id join itens i on i.id = t.item_id
      where t.setor_id = ${setorAtual.id} and t.status <> 'concluida' and o.status in ('firmada', 'liberada', 'em_processo')
      order by t.fila_manual nulls last, t.inicio_previsto nulls last, o.prioridade desc, o.data_necessidade, t.id limit 200`
    : [];
  const ops = await sql`
    select o.id, o.numero, o.status, o.data_necessidade, o.inicio_previsto, o.fim_previsto, o.prioridade, i.codigo, i.descricao
    from ordens_producao o join itens i on i.id = o.item_id
    where o.status in ('firmada', 'liberada', 'em_processo') order by o.fim_previsto nulls last`;
  const prog = await programaDaSemana(semana);
  const [resumo] = await sql`
    select count(*)::int as n, coalesce(sum(t.tempo_previsto_min), 0) as min
    from tarefas t join ordens_producao o on o.id = t.op_id
    where o.status in ('firmada', 'liberada', 'em_processo') and t.status <> 'concluida'
      and (t.fim_previsto at time zone 'America/Sao_Paulo')::date < ${somarDias(semana, 7)}::date`;
  const podeMover = PODE_LIDERAR.includes(u.perfil) || u.perfil === "admin";
  const podeAprovar = PODE_APROVAR.includes(u.perfil);

  // escala do gráfico de OPs: hoje até 6 semanas
  const dias = 42;
  const pos = (d: string | Date | null) => {
    if (!d) return 0;
    const s = d instanceof Date ? d.toISOString().slice(0, 10) : d;
    return Math.max(0, Math.min(100, (diferencaDias(s, hoje) / dias) * 100));
  };

  return (
    <>
      <Cabecalho coord="Planejar" titulo="Programação da produção" sub="Capacidade finita por setor: cada recurso (pessoa/posto) é uma raia; as etapas entram por prioridade, data prometida e dependência entre peças e conjuntos." acoes={
        <form action={reprogramarAction}><button className="btn-pri">Recalcular programação</button></form>
      } />
      <Aviso busca={sp} />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card titulo="Carga x capacidade · 6 semanas" corpo="p-0">
          <CargaCapacidade carga={carga} setores={setores} />
        </Card>
        <Card titulo={`Programa da semana · ${fmtData(semana)}`}>
          {prog?.status === "aprovado" ? (
            <p className="text-sm"><span className="badge bg-emerald-100 text-emerald-800">aprovado</span> por {prog.aprovado_por_nome as string} em {fmtDataHora(prog.aprovado_em as Date)}.</p>
          ) : (
            <p className="text-sm"><span className="badge bg-amber-100 text-amber-800">aguardando aprovação</span></p>
          )}
          <p className="mt-2 text-sm text-apagado">{resumo.n} etapas ({fmtMin(resumo.min as number)}) previstas para terminar até sexta.</p>
          {podeAprovar ? (
            <form action={aprovarAction} className="mt-3 space-y-2">
              <input type="hidden" name="semana" value={semana} />
              <input name="observacao" className="inp" placeholder="Observação (opcional)" />
              <button className="btn-pri w-full">{prog?.status === "aprovado" ? "Reaprovar com o plano atual" : "Aprovar programa"}</button>
            </form>
          ) : (
            <p className="mt-3 text-xs text-apagado">A diretoria aprova o programa uma vez por semana, na reunião de PCP. Dentro do programa aprovado o PCP libera as OPs sem nova aprovação; exceções sobem com alçada definida.</p>
          )}
        </Card>
      </div>

      <Card titulo="OPs no tempo · próximas 6 semanas" className="mt-4" corpo="p-4">
        {ops.length === 0 ? <Vazio>Nenhuma OP aberta.</Vazio> : (
          <div className="space-y-1.5">
            <div className="relative ml-48 h-4 text-[10px] text-apagado">
              {[0, 7, 14, 21, 28, 35].map((d) => (
                <span key={d} className="absolute" style={{ left: `${(d / dias) * 100}%` }}>{fmtData(somarDias(hoje, d)).slice(0, 5)}</span>
              ))}
            </div>
            {ops.map((o) => {
              const ini = pos(o.inicio_previsto as Date);
              const fim = pos(o.fim_previsto as Date);
              const prom = pos(o.data_necessidade as string);
              const fimD = o.fim_previsto ? (o.fim_previsto as Date).toISOString().slice(0, 10) : null;
              const atrasa = fimD && fimD > (o.data_necessidade as string);
              return (
                <div key={o.id as number} className="flex items-center gap-2">
                  <Link href={`/ops/${o.id}`} className="w-46 shrink-0 truncate text-xs hover:underline"><b>{o.numero}</b> <span className="font-mono text-apagado">{o.codigo}</span></Link>
                  <div className="relative h-5 flex-1 rounded bg-carta">
                    <div className={`absolute top-0.5 h-4 rounded ${atrasa ? "bg-alerta/80" : o.status === "firmada" ? "bg-atencao/60" : "bg-processo/80"}`} style={{ left: `${ini}%`, width: `${Math.max(0.8, fim - ini)}%` }} />
                    <div className="absolute -top-0.5 h-6 w-0.5 bg-tinta" style={{ left: `${prom}%` }} title={`Promessa ${fmtData(o.data_necessidade as string)}`} />
                  </div>
                  <StatusOP s={o.status as string} />
                </div>
              );
            })}
            <p className="pt-2 text-xs text-apagado">Barra = início ao fim previstos; traço preto = data prometida. Vermelho: termina depois da promessa. Amarelo: OP firmada ainda não liberada.</p>
          </div>
        )}
      </Card>

      <Card titulo="Fila por setor" className="mt-4" corpo="p-0" acoes={
        <div className="flex flex-wrap gap-1">
          {setores.map((s) => (
            <Link key={s.id} href={`/programacao?setor=${s.codigo}`} className={s.id === setorAtual?.id ? "btn-pri btn-xs" : "btn-sec btn-xs"}>{s.nome}</Link>
          ))}
        </div>
      }>
        {fila.length === 0 ? <Vazio>Fila vazia neste setor.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>#</th><th>OP</th><th>Peça / operação</th><th className="num">Qtd</th><th className="num">Tempo</th><th>Situação</th><th>Previsto</th><th>Promessa</th>{podeMover && <th>Ordem</th>}</tr></thead>
              <tbody>
                {fila.map((t, i) => (
                  <tr key={t.id as number} className={t.fila_manual ? "bg-latao/5" : ""}>
                    <td className="tabular-nums text-apagado">{i + 1}{t.fila_manual && <span className="badge ml-1 bg-latao/25 text-latao-escuro" title="posição fixada manualmente">fixa</span>}</td>
                    <td><Link href={`/ops/${t.op_id}`} className="font-semibold hover:underline">{t.numero}</Link> <StatusOP s={t.op_status as string} /></td>
                    <td><span className="font-mono text-xs">{t.codigo as string}</span><div className="text-xs text-apagado">{t.descricao as string}</div></td>
                    <td className="num">{fmtQtd(t.quantidade as number)}</td>
                    <td className="num text-xs">{fmtMin(t.tempo_previsto_min as number)}</td>
                    <td>{t.status === "pendente" ? (t.pronta ? <span className="badge bg-emerald-100 text-emerald-800">pronta</span> : <span className="badge bg-slate-100 text-slate-500">aguarda etapa</span>) : <StatusTarefa s={t.status as string} />}</td>
                    <td className="whitespace-nowrap text-xs">{fmtDataHora(t.inicio_previsto as Date)}</td>
                    <td className="whitespace-nowrap text-xs">{fmtData(t.data_necessidade as string)}</td>
                    {podeMover && (
                      <td className="whitespace-nowrap">
                        {(["topo", "subir", "descer"] as const).map((d) => (
                          <form key={d} action={moverAction} className="inline">
                            <input type="hidden" name="tarefa_id" value={t.id as number} />
                            <input type="hidden" name="setor" value={setorAtual!.codigo} />
                            <input type="hidden" name="direcao" value={d} />
                            <button className="btn-sec btn-xs mr-1" title={d}>{d === "topo" ? "⤒" : d === "subir" ? "↑" : "↓"}</button>
                          </form>
                        ))}
                        {t.fila_manual && (
                          <form action={moverAction} className="inline">
                            <input type="hidden" name="tarefa_id" value={t.id as number} />
                            <input type="hidden" name="setor" value={setorAtual!.codigo} />
                            <input type="hidden" name="direcao" value="limpar" />
                            <button className="btn-sec btn-xs" title="voltar para a ordem automática">auto</button>
                          </form>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
