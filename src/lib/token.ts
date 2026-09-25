import { timingSafeEqual } from "node:crypto";

/** Compara o token do cabeçalho Authorization: Bearer com a variável de ambiente. */
export function autorizado(req: Request, variavel: string): boolean {
  const esperado = process.env[variavel];
  if (!esperado || esperado.length < 16) return false;
  const h = req.headers.get("authorization") ?? "";
  const recebido = h.startsWith("Bearer ") ? h.slice(7) : new URL(req.url).searchParams.get("token") ?? "";
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}
