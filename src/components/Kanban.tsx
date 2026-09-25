import { fmtData, fmtMin, fmtQtd } from "@/lib/formato";
import type { Quadro } from "@/server/kanban";

const desde = (d: Date | null) => (d ? fmtMin((Date.now() - new Date(d).getTime()) / 60000) : "");

export function Kanban({ quadro, tv = false }: { quadro: Quadro; tv?: boolean }) {
  const t = tv ? "text-base" : "text-xs";
  return (
    <div className={`grid gap-3 ${tv ? "grid-cols-3 2xl:grid-cols-6" : "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6"}`}>
      {quadro.map((c) => (
        <section key={c.setor.id as number} className={`flex flex-col rounded-lg border ${c.paradaSetor ? "border-alerta bg-red-50" : tv ? "border-white/10 bg-white/5" : "border-linha bg-white"}`}>
          <header className={`flex items-center justify-between border-b px-3 py-2 ${tv ? "border-white/10" : "border-linha"}`}>
            <div>
              <div className={`font-semibold ${tv ? "text-xl" : "text-sm"}`}>{c.setor.nome as string}</div>
              <div className={`${t} opacity-60`}>{c.concluidasHoje} concluídas hoje · {c.prontas.length} prontas · {c.aguardando.length} aguardando</div>
            </div>
            {c.setor.eh_gargalo && <span className="badge bg-latao/30 text-latao-escuro">gargalo</span>}
          </header>
          {c.paradaSetor && (
            <div className={`bg-alerta px-3 py-2 font-semibold text-white ${t}`}>SETOR PARADO: {c.paradaSetor.descricao as string} · há {desde(c.paradaSetor.inicio as Date)}</div>
          )}
          <div className="flex-1 space-y-2 p-2">
            {c.paradas.map((x) => (
              <Cartao key={x.id as number} x={x} tv={tv} cor="border-l-alerta bg-red-50 text-tinta" topo={`PARADA · ${x.motivo ?? ""} · há ${desde(x.parada_desde as Date)}`} />
            ))}
            {c.emProcesso.map((x) => (
              <Cartao key={x.id as number} x={x} tv={tv} cor="border-l-processo bg-blue-50 text-tinta" topo={`EM PROCESSO · ${x.operador ?? ""} · há ${desde(x.desde as Date)}`} />
            ))}
            {c.prontas.slice(0, tv ? 4 : 6).map((x, i) => (
              <Cartao key={x.id as number} x={x} tv={tv} cor={`border-l-ok ${tv ? "bg-white/90 text-tinta" : "bg-white"}`} topo={i === 0 ? "PRÓXIMA" : `FILA ${i + 1}`} />
            ))}
            {c.prontas.length > (tv ? 4 : 6) && <div className={`${t} px-1 opacity-60`}>+{c.prontas.length - (tv ? 4 : 6)} prontas na fila</div>}
            {c.emProcesso.length + c.paradas.length + c.prontas.length === 0 && <div className={`${t} px-1 py-4 text-center opacity-60`}>{c.aguardando.length ? `Nada pronto agora · ${c.aguardando.length} aguardando etapa anterior` : "Sem trabalho liberado"}</div>}
          </div>
        </section>
      ))}
    </div>
  );
}

function Cartao({ x, tv, cor, topo }: { x: Record<string, unknown>; tv: boolean; cor: string; topo: string }) {
  return (
    <div className={`rounded-md border border-linha border-l-4 px-2.5 py-2 ${cor}`}>
      <div className={`font-mono font-semibold tracking-wide opacity-70 ${tv ? "text-xs" : "text-[10px]"}`}>{topo}</div>
      <div className={`mt-0.5 flex items-baseline justify-between gap-2 ${tv ? "text-lg" : "text-sm"}`}>
        <span className="font-semibold">OP {x.numero as number}</span>
        <span className="tabular-nums">{fmtQtd(x.quantidade as number)} un</span>
      </div>
      <div className={`${tv ? "text-sm" : "text-xs"} truncate`}><span className="font-mono">{x.codigo as string}</span> {x.item_descricao as string}</div>
      <div className={`${tv ? "text-xs" : "text-[11px]"} flex justify-between opacity-70`}>
        <span className="truncate">{x.descricao as string}</span>
        <span className="shrink-0">entrega {fmtData(x.data_necessidade as string).slice(0, 5)}</span>
      </div>
    </div>
  );
}
