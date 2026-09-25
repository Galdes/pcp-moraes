import Link from "next/link";
import { Card, Cabecalho, Kpi, StatusOP, Vazio } from "@/components/ui";
import { CargaCapacidade, Medidor, ParetoBarras } from "@/components/Graficos";
import { faltasMaterial, kpis, oeePorSetor, opsAtrasadas, paretoParadas } from "@/server/indicadores";
import { cargaPorSetor } from "@/server/programacao";
import { hojeNoFuso, somarDias } from "@/domain/datas";
import { fmtData, fmtNum, fmtPct, fmtQtd } from "@/lib/formato";

export const dynamic = "force-dynamic";
export const metadata = { title: "Painel" };

export default async function Painel() {
  const hoje = hojeNoFuso();
  const [k, par, atr, falt, oee, { carga, setores }] = await Promise.all([
    kpis(30),
    paretoParadas(30),
    opsAtrasadas(),
    faltasMaterial(),
    oeePorSetor(somarDias(hoje, -13), hoje, true),
    cargaPorSetor(4),
  ]);
  const META_OEE = 0.65;
  return (
    <>
      <Cabecalho coord={`Gestão à vista · ${fmtData(hoje)}`} titulo="Painel da produção" sub="Últimos 30 dias para entregas e paradas; próximas 4 semanas para carga." />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi rotulo="Entregas no prazo (OTD)" valor={fmtPct(k.otd)} detalhe={`${k.concluidas} máquinas concluídas em 30 dias`} tom={k.otd === null ? "neutro" : k.otd >= 0.9 ? "ok" : k.otd >= 0.7 ? "atencao" : "alerta"} />
        <Kpi rotulo="Aderência ao programa" valor={fmtPct(k.aderencia)} detalhe={k.aderencia_planejadas ? `semana de ${fmtData(k.aderencia_semana)} · ${k.aderencia_planejadas} tarefas` : "sem programa aprovado na semana passada"} tom={k.aderencia === null ? "neutro" : k.aderencia >= 0.85 ? "ok" : k.aderencia >= 0.7 ? "atencao" : "alerta"} href="/programacao" />
        <Kpi rotulo="Lead time da máquina" valor={k.lead_time_dias === null ? "–" : `${fmtNum(k.lead_time_dias, 1)} d`} detalhe="da liberação ao fim da montagem" />
        <Kpi rotulo="Máquinas em processo" valor={k.wip} detalhe="OPs liberadas ou em execução" href="/ops?status=abertas" />
        <Kpi rotulo="OPs atrasadas ou em risco" valor={k.atrasadas} detalhe="vencidas ou com fim previsto após a promessa" tom={k.atrasadas ? "alerta" : "ok"} href="#atrasadas" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" titulo="Carga x capacidade por setor" acoes={<Link href="/programacao" className="btn-sec btn-xs">Programação</Link>} corpo="p-0">
          <CargaCapacidade carga={carga} setores={setores} />
          <p className="border-t border-linha px-4 py-2 text-xs text-apagado">
            Carga = horas que o setor precisa trabalhar em cada semana para cumprir as datas prometidas (programação para trás). Acima de 100% a data não fecha sem hora extra, terceirização ou nova promessa.
          </p>
        </Card>
        <Card titulo="OEE do gargalo · 14 dias">
          {oee.length === 0 ? (
            <Vazio>Marque o setor gargalo em Setores e capacidade.</Vazio>
          ) : (
            oee.map((o) => (
              <div key={o.setor.id} className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="font-medium">{o.setor.nome}</span>
                  <span className={`text-3xl font-semibold tabular-nums ${o.oee >= META_OEE ? "text-ok" : "text-alerta"}`}>{fmtPct(o.oee, 1)}</span>
                </div>
                <Medidor rotulo="Disponibilidade" valor={o.disponibilidade} meta={0.9} />
                <Medidor rotulo="Performance" valor={o.performance} meta={0.85} />
                <Medidor rotulo="Qualidade" valor={o.qualidade} meta={0.99} />
                <div className="border-t border-linha pt-3">
                  <Medidor rotulo="Utilização da capacidade (fora do OEE)" valor={o.utilizacao} />
                </div>
                {o.performance > 1.1 && <p className="text-xs text-atencao">Performance acima de 100%: o tempo padrão deste setor está folgado. Revise o roteiro.</p>}
                <p className="text-xs text-apagado">Meta de OEE {fmtPct(META_OEE)}. {fmtNum(o.tempo_operando_min / 60, 1)} h produzindo de {fmtNum(o.tempo_programado_min / 60, 1)} h com trabalho no setor. Utilização baixa indica falta de carga, não ineficiência.</p>
              </div>
            ))
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card titulo="OPs atrasadas ou em risco" className="xl:col-span-2" corpo="p-0">
          <div id="atrasadas" className="overflow-x-auto">
            {atr.length === 0 ? (
              <Vazio>Nenhuma OP atrasada ou com fim previsto após a data prometida.</Vazio>
            ) : (
              <table className="tbl">
                <thead>
                  <tr><th>OP</th><th>Máquina</th><th>Status</th><th>Prometida</th><th>Fim previsto</th><th>Onde está</th></tr>
                </thead>
                <tbody>
                  {atr.map((o) => (
                    <tr key={o.id as number}>
                      <td><Link className="font-semibold underline-offset-2 hover:underline" href={`/ops/${o.id}`}>{o.numero}</Link></td>
                      <td><div className="font-mono text-xs">{o.codigo}</div><div className="text-xs text-apagado">{o.descricao}</div></td>
                      <td><StatusOP s={o.status as string} /></td>
                      <td className="whitespace-nowrap">{fmtData(o.data_necessidade as string)}</td>
                      <td className="whitespace-nowrap font-medium text-alerta">{fmtData(o.fim_previsto as Date)}</td>
                      <td className="text-xs">
                        {(o.setores_atuais as string) ?? "–"}
                        {(o.paradas_abertas as number) > 0 && <span className="badge ml-1 bg-red-600 text-white">parada</span>}
                        {o.falta_assumida_obs && <div className="text-atencao">Falta assumida: {o.falta_assumida_obs as string}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        <Card titulo="Pareto de paradas · 30 dias">
          {par.length === 0 ? <Vazio>Sem paradas não planejadas registradas.</Vazio> : <ParetoBarras itens={par} />}
          <p className="mt-3 text-xs text-apagado">Barras em vermelho: as causas que somam 80% do tempo parado. Ataque essas primeiro.</p>
        </Card>
      </div>

      <Card titulo="Faltas de material travando OPs" className="mt-4" corpo="p-0" acoes={<Link href="/mrp" className="btn-sec btn-xs">Abrir MRP</Link>}>
        {falt.length === 0 ? (
          <Vazio>Nenhuma falta: o estoque cobre todas as OPs firmadas e liberadas.</Vazio>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Item</th><th className="num">Necessário</th><th className="num">Saldo</th><th className="num">Falta</th><th>OPs</th><th>Próx. recebimento</th></tr></thead>
              <tbody>
                {falt.map((f) => (
                  <tr key={f.codigo as string}>
                    <td><span className="font-mono text-xs">{f.codigo as string}</span> <span className="text-xs text-apagado">{f.descricao as string}</span></td>
                    <td className="num">{fmtQtd(Number(f.necessario))} {f.unidade as string}</td>
                    <td className="num">{fmtQtd(Number(f.saldo))}</td>
                    <td className="num font-semibold text-alerta">{fmtQtd(Number(f.falta))}</td>
                    <td className="text-xs">{(f.ops as number[]).join(", ")}</td>
                    <td className="whitespace-nowrap text-xs">{f.proximo_recebimento ? fmtData(f.proximo_recebimento as string) : <span className="text-alerta">sem pedido de compra</span>}</td>
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
