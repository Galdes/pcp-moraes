import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card } from "@/components/ui";
import { exigir, NOME_PERFIL, type Perfil } from "@/server/auth";
import { salvarUsuarioAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usuários" };

export default async function Usuarios({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await exigir("admin");
  const sp = await searchParams;
  const usuarios = await sql`select u.*, s.nome as setor from usuarios u left join setores s on s.id = u.setor_id order by u.perfil, u.nome`;
  const setores = await sql`select id, nome from setores order by sequencia`;
  const Linha = ({ u }: { u?: Record<string, unknown> }) => (
    <form action={salvarUsuarioAction} className={`grid grid-cols-2 items-center gap-2 border-b border-linha px-3 py-2 md:grid-cols-[1.3fr_1fr_140px_140px_150px_60px_auto] ${u ? "" : "bg-carta/40"} ${u && !u.ativo ? "opacity-50" : ""}`}>
      <input type="hidden" name="id" value={(u?.id as number) ?? ""} />
      <input name="nome" defaultValue={(u?.nome as string) ?? ""} className="inp" placeholder="Nome" />
      <input name="login" defaultValue={(u?.login as string) ?? ""} className="inp" placeholder="login ou matrícula" />
      <select name="perfil" defaultValue={(u?.perfil as string) ?? "operador"} className="inp">
        {(Object.keys(NOME_PERFIL) as Perfil[]).map((p) => <option key={p} value={p}>{NOME_PERFIL[p]}</option>)}
      </select>
      <select name="setor_id" defaultValue={(u?.setor_id as number) ?? ""} className="inp">
        <option value="">sem setor</option>
        {setores.map((s) => <option key={s.id as number} value={s.id as number}>{s.nome as string}</option>)}
      </select>
      <input name="segredo" type="password" className="inp" placeholder={u ? "nova senha/PIN" : "senha ou PIN"} autoComplete="new-password" />
      <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="ativo" defaultChecked={u ? (u.ativo as boolean) : true} /> ativo</label>
      <button className={u ? "btn-sec btn-xs" : "btn-pri btn-xs"}>{u ? "salvar" : "incluir"}</button>
    </form>
  );
  return (
    <>
      <Cabecalho coord="Sistema" titulo="Usuários" sub="Escritório entra com login e senha (mín. 8 caracteres). Operadores entram no tablet com matrícula e PIN de 4 a 6 dígitos." />
      <Aviso busca={sp} />
      <Card corpo="p-0">
        {usuarios.map((u) => <Linha key={u.id as number} u={u} />)}
        <Linha />
      </Card>
      <p className="mt-3 text-xs text-apagado">
        Perfis: Administrador (tudo) · Diretoria (vê tudo e aprova o programa semanal) · PCP (planeja, libera OPs, roda MRP) · Líder (reordena a fila do setor e aponta) · Operador (só o posto) · Visualizador (consulta).
      </p>
    </>
  );
}
