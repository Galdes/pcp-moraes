import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "@/lib/db";

export type Perfil = "admin" | "diretoria" | "pcp" | "lider" | "operador" | "visualizador";

export interface Usuario {
  id: number;
  nome: string;
  login: string;
  perfil: Perfil;
  setor_id: number | null;
}

const COOKIE = "pcp_sessao";
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function hashSegredo(s: string) {
  return bcrypt.hash(s, 10);
}

async function abrirSessao(usuarioId: number, horas: number) {
  const token = randomBytes(32).toString("base64url");
  const expira = new Date(Date.now() + horas * 3_600_000);
  await sql`insert into sessoes (token_hash, usuario_id, expira_em) values (${hashToken(token)}, ${usuarioId}, ${expira})`;
  await sql`delete from sessoes where expira_em < now()`;
  await sql`delete from tentativas_login where created_at < now() - interval '30 days'`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_INSEGURO !== "1",
    path: "/",
    expires: expira,
  });
}

// Mesma resposta e tempo parecido para usuário inexistente e senha errada.
let hashFalso: string | null = null;
const HASH_FALSO = () => (hashFalso ??= bcrypt.hashSync("nao-usar-" + randomBytes(8).toString("hex"), 10));

const MAX_FALHAS = 5;
const JANELA_MIN = 15;

export class ErroBloqueio extends Error {}

/**
 * Confere a credencial com trava por login: tentativas em paralelo passam uma
 * de cada vez, então o limite de 5 falhas em 15 minutos não é contornável.
 */
async function conferir(login: string, segredo: string, tipo: "senha" | "pin"): Promise<number | null> {
  return sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext(${"login:" + login.toLowerCase()}))`;
    const [r] = await tx`
      select count(*)::int as falhas from tentativas_login
      where lower(login) = lower(${login}) and not sucesso and created_at > now() - ${`${JANELA_MIN} minutes`}::interval
        and created_at > coalesce((select max(created_at) from tentativas_login where lower(login) = lower(${login}) and sucesso), '-infinity')`;
    if (r.falhas >= MAX_FALHAS) throw new ErroBloqueio(`Muitas tentativas. Aguarde ${JANELA_MIN} minutos ou ${tipo === "pin" ? "chame o líder" : "peça ao administrador"}.`);
    const [u] =
      tipo === "senha"
        ? await tx`select id, senha_hash as h from usuarios where lower(login) = lower(${login}) and ativo and perfil <> 'operador'`
        : await tx`select id, pin_hash as h from usuarios where login = ${login} and ativo and pin_hash is not null`;
    const ok = await bcrypt.compare(segredo, (u?.h as string) ?? HASH_FALSO());
    await tx`insert into tentativas_login (login, sucesso) values (${login}, ${!!u && ok})`;
    return u && ok ? (u.id as number) : null;
  }) as Promise<number | null>;
}

export async function entrarComSenha(login: string, senha: string): Promise<boolean> {
  const id = await conferir(login.trim(), senha, "senha");
  if (!id) return false;
  await abrirSessao(id, 10);
  return true;
}

export async function entrarComPin(matricula: string, pin: string): Promise<boolean> {
  const id = await conferir(matricula.trim(), pin, "pin");
  if (!id) return false;
  await abrirSessao(id, 12);
  return true;
}

export async function sair() {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  if (t) await sql`delete from sessoes where token_hash = ${hashToken(t)}`;
  c.delete(COOKIE);
}

export async function usuarioAtual(): Promise<Usuario | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  const [u] = await sql<Usuario[]>`
    select u.id, u.nome, u.login, u.perfil, u.setor_id
    from sessoes s join usuarios u on u.id = s.usuario_id
    where s.token_hash = ${hashToken(t)} and s.expira_em > now() and u.ativo`;
  return u ?? null;
}

/** Garante sessão e perfil; operador que cai numa tela de escritório vai para o posto. */
export async function exigir(...perfis: Perfil[]): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect("/login");
  if (perfis.length && !perfis.includes(u.perfil) && u.perfil !== "admin") {
    if (u.perfil === "operador") redirect("/posto");
    throw new Error("Sem permissão para esta ação");
  }
  return u;
}

export const PODE_PLANEJAR: Perfil[] = ["admin", "pcp"];
export const PODE_APROVAR: Perfil[] = ["admin", "diretoria"];
export const PODE_LIDERAR: Perfil[] = ["admin", "pcp", "lider"];
export const ESCRITORIO: Perfil[] = ["admin", "diretoria", "pcp", "lider", "visualizador"];

export const NOME_PERFIL: Record<Perfil, string> = {
  admin: "Administrador",
  diretoria: "Diretoria",
  pcp: "PCP",
  lider: "Líder de setor",
  operador: "Operador",
  visualizador: "Visualizador",
};
