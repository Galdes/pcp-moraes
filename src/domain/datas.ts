// Utilitários de data em formato 'YYYY-MM-DD' (datas de negócio, sem fuso).
// Tudo aqui é puro e testável: nada lê o relógio do sistema.

export function paraData(s: string): Date {
  const [a, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

export function deData(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function somarDias(s: string, n: number): string {
  const d = paraData(s);
  d.setUTCDate(d.getUTCDate() + n);
  return deData(d);
}

export function diferencaDias(a: string, b: string): number {
  return Math.round((paraData(a).getTime() - paraData(b).getTime()) / 86_400_000);
}

/** 0 = domingo ... 6 = sábado */
export function diaSemana(s: string): number {
  return paraData(s).getUTCDay();
}

export function segundaDaSemana(s: string): string {
  const dow = diaSemana(s);
  return somarDias(s, dow === 0 ? -6 : 1 - dow);
}

export function hojeNoFuso(agora: Date = new Date(), fuso = "America/Sao_Paulo"): string {
  // en-CA formata como YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}

export function formatarBR(s: string | null | undefined): string {
  if (!s) return "";
  const [a, m, d] = s.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/** Formato exigido pela API do Omie: dd/mm/aaaa */
export function formatarOmie(s: string): string {
  return formatarBR(s);
}

export function deOmie(s: string | undefined | null): string | null {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
