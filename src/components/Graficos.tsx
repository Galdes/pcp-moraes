import { fmtDataCurta, fmtMin, fmtPct } from "@/lib/formato";
import type { CargaSemana } from "@/domain/programacao";

export function CargaCapacidade({ carga, setores }: { carga: CargaSemana[]; setores: { id: number; nome: string; eh_gargalo?: boolean }[] }) {
  const semanas = [...new Set(carga.map((c) => c.semana))].sort();
  const mapa = new Map(carga.map((c) => [`${c.setor_id}|${c.semana}`, c]));
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Setor</th>
            {semanas.map((s, i) => (
              <th key={s} className="!text-center">{i === 0 ? "Esta semana" : `Sem. ${fmtDataCurta(s).replace(/^\w+\.?,?\s*/, "")}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {setores.map((s) => (
            <tr key={s.id}>
              <td className="whitespace-nowrap font-medium">
                {s.nome}
                {s.eh_gargalo && <span className="badge ml-1.5 bg-latao/20 text-latao-escuro">gargalo</span>}
              </td>
              {semanas.map((w) => {
                const c = mapa.get(`${s.id}|${w}`)!;
                const pct = c.capacidade_min > 0 ? c.carga_min / c.capacidade_min : c.carga_min > 0 ? 9 : 0;
                const cor = pct > 1 ? "bg-alerta" : pct > 0.85 ? "bg-atencao" : "bg-ok";
                return (
                  <td key={w} className="min-w-28" title={`Carga ${fmtMin(c.carga_min)} · Capacidade ${fmtMin(c.capacidade_min)}${c.atrasada_min ? ` · ${fmtMin(c.atrasada_min)} já atrasados` : ""}`}>
                    <div className="flex items-baseline justify-between text-xs tabular-nums">
                      <span className={pct > 1 ? "font-semibold text-alerta" : ""}>{c.capacidade_min ? fmtPct(pct) : c.carga_min ? "sem cap." : "–"}</span>
                      <span className="text-apagado">{fmtMin(c.carga_min)}</span>
                    </div>
                    <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-linha/70">
                      <div className={`h-2 ${cor}`} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                    </div>
                    {c.atrasada_min > 0 && <div className="mt-0.5 text-[10px] font-medium text-alerta">{fmtMin(c.atrasada_min)} atrasado</div>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ParetoBarras({ itens }: { itens: { chave: string; valor: number; pct: number; pct_acumulado: number }[] }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <ul className="space-y-2">
      {itens.slice(0, 8).map((i) => (
        <li key={i.chave}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate font-medium">{i.chave}</span>
            <span className="shrink-0 tabular-nums text-apagado">{fmtMin(i.valor)} · {fmtPct(i.pct)} <span className="text-apagado/70">(acum. {fmtPct(i.pct_acumulado)})</span></span>
          </div>
          <div className="mt-1 h-2.5 w-full overflow-hidden rounded bg-linha/60">
            <div className={`h-2.5 ${i.pct_acumulado <= 0.8 ? "bg-alerta/80" : "bg-apagado/40"}`} style={{ width: `${(i.valor / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Medidor({ rotulo, valor, meta }: { rotulo: string; valor: number; meta?: number }) {
  const cor = meta === undefined ? "bg-petroleo" : valor >= meta ? "bg-ok" : valor >= meta * 0.8 ? "bg-atencao" : "bg-alerta";
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-apagado">{rotulo}</span>
        <span className="font-semibold tabular-nums">{fmtPct(valor, 1)}</span>
      </div>
      <div className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-linha/70">
        <div className={`h-2 ${cor}`} style={{ width: `${Math.min(100, valor * 100)}%` }} />
        {meta !== undefined && <div className="absolute top-0 h-2 w-0.5 bg-tinta" style={{ left: `${meta * 100}%` }} />}
      </div>
    </div>
  );
}
