import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_OP, STATUS_TAREFA } from "@/lib/formato";

export function Cabecalho({ titulo, sub, acoes, coord }: { titulo: string; sub?: ReactNode; acoes?: ReactNode; coord?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        {coord && <div className="coord mb-1">{coord}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {sub && <div className="mt-1 text-sm text-apagado">{sub}</div>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2 no-print">{acoes}</div>}
    </div>
  );
}

export function Card({ titulo, acoes, children, className = "", corpo = "p-4" }: { titulo?: ReactNode; acoes?: ReactNode; children: ReactNode; className?: string; corpo?: string }) {
  return (
    <section className={`card ${className}`}>
      {(titulo || acoes) && (
        <div className="card-h">
          <h2 className="card-t">{titulo}</h2>
          {acoes && <div className="flex items-center gap-2">{acoes}</div>}
        </div>
      )}
      <div className={corpo}>{children}</div>
    </section>
  );
}

export function Aviso({ busca }: { busca: { ok?: string; erro?: string } }) {
  if (busca.erro)
    return <div role="alert" className="mb-4 rounded-md border border-alerta/30 bg-alerta/5 px-4 py-2.5 text-sm text-alerta">{busca.erro}</div>;
  if (busca.ok)
    return <div role="status" className="mb-4 rounded-md border border-ok/30 bg-ok/5 px-4 py-2.5 text-sm text-ok">{busca.ok}</div>;
  return null;
}

export function StatusOP({ s }: { s: string }) {
  const x = STATUS_OP[s] ?? { rotulo: s, cor: "bg-slate-100" };
  return <span className={`badge ${x.cor}`}>{x.rotulo}</span>;
}

export function StatusTarefa({ s }: { s: string }) {
  const x = STATUS_TAREFA[s] ?? { rotulo: s, cor: "bg-slate-100" };
  return <span className={`badge ${x.cor}`}>{x.rotulo}</span>;
}

export function Vazio({ children }: { children: ReactNode }) {
  return <div className="px-4 py-8 text-center text-sm text-apagado">{children}</div>;
}

export function Kpi({ rotulo, valor, detalhe, tom = "neutro", href }: { rotulo: string; valor: ReactNode; detalhe?: ReactNode; tom?: "neutro" | "ok" | "atencao" | "alerta"; href?: string }) {
  const cor = { neutro: "border-t-latao", ok: "border-t-ok", atencao: "border-t-atencao", alerta: "border-t-alerta" }[tom];
  const conteudo = (
    <div className={`card h-full border-t-4 ${cor} p-4`}>
      <div className="coord">{rotulo}</div>
      <div className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-apagado">{detalhe}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-90">{conteudo}</Link> : conteudo;
}

export function Barra({ valor, max, cor = "bg-petroleo", alto = "h-2" }: { valor: number; max: number; cor?: string; alto?: string }) {
  const pct = max > 0 ? Math.min(100, (valor / max) * 100) : 0;
  return (
    <div className={`w-full overflow-hidden rounded-full bg-linha/70 ${alto}`}>
      <div className={`${alto} ${cor}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
