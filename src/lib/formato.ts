export const fmtNum = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined || Number.isNaN(n) ? "–" : Number(n).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

export const fmtQtd = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 3 });

export const fmtPct = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined ? "–" : `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export function fmtData(s: string | Date | null | undefined) {
  if (!s) return "–";
  if (s instanceof Date) return s.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function fmtDataCurta(s: string | Date | null | undefined) {
  if (!s) return "–";
  const d = s instanceof Date ? s : new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", weekday: "short" });
}

export function fmtDataHora(s: string | Date | null | undefined) {
  if (!s) return "–";
  const d = s instanceof Date ? s : new Date(s);
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function fmtMin(min: number | null | undefined) {
  if (min === null || min === undefined) return "–";
  const m = Math.round(Number(min));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h${String(r).padStart(2, "0")}` : `${h}h`;
}

export const STATUS_OP: Record<string, { rotulo: string; cor: string }> = {
  sugerida: { rotulo: "Sugerida", cor: "bg-slate-100 text-slate-600" },
  firmada: { rotulo: "Firmada", cor: "bg-amber-100 text-amber-800" },
  liberada: { rotulo: "Liberada", cor: "bg-sky-100 text-sky-800" },
  em_processo: { rotulo: "Em processo", cor: "bg-blue-600 text-white" },
  concluida: { rotulo: "Concluída", cor: "bg-emerald-100 text-emerald-800" },
  cancelada: { rotulo: "Cancelada", cor: "bg-slate-200 text-slate-500 line-through" },
};

export const STATUS_TAREFA: Record<string, { rotulo: string; cor: string }> = {
  pendente: { rotulo: "A fazer", cor: "bg-slate-100 text-slate-700" },
  em_processo: { rotulo: "Em processo", cor: "bg-blue-600 text-white" },
  pausada: { rotulo: "Parada", cor: "bg-red-600 text-white" },
  concluida: { rotulo: "Concluída", cor: "bg-emerald-100 text-emerald-800" },
};

export const TIPO_ITEM: Record<string, string> = {
  produto: "Produto",
  conjunto: "Conjunto",
  peca: "Peça",
  materia_prima: "Matéria-prima",
  componente_comprado: "Comprado",
};
