"use client";
import Link from "next/link";
import { useRef } from "react";

/**
 * Filtro de período do painel (GET ?periodo=&de=&ate=).
 * Mexer nas datas muda o período para "Personalizado"; escolher um período
 * pronto envia na hora.
 */
export function FiltroPeriodo({ presets, chave, de, ate, hoje, demanda }: { presets: [string, string][]; chave: string; de: string; ate: string; hoje: string; demanda?: string }) {
  const form = useRef<HTMLFormElement>(null);
  const sel = useRef<HTMLSelectElement>(null);
  const personalizar = () => {
    if (sel.current) sel.current.value = "personalizado";
  };
  return (
    <form ref={form} method="get" className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3 text-sm">
      {demanda && <input type="hidden" name="demanda" value={demanda} />}
      <label className="grid gap-0.5">
        <span className="lbl mb-0">Período</span>
        <select
          ref={sel}
          name="periodo"
          defaultValue={chave}
          className="inp w-48"
          onChange={(e) => {
            if (e.target.value !== "personalizado") form.current?.requestSubmit();
          }}
        >
          {presets.map(([v, r]) => (
            <option key={v} value={v}>{r}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-0.5">
        <span className="lbl mb-0">De</span>
        <input type="date" name="de" defaultValue={de} max={hoje} className="inp w-40" onChange={personalizar} />
      </label>
      <label className="grid gap-0.5">
        <span className="lbl mb-0">Até</span>
        <input type="date" name="ate" defaultValue={ate} max={hoje} className="inp w-40" onChange={personalizar} />
      </label>
      <button className="btn-pri">Filtrar</button>
      {chave !== "30" && <Link href="/" className="btn-sec">Voltar aos últimos 30 dias</Link>}
    </form>
  );
}
