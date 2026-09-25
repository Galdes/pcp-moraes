import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { usuarioAtual } from "@/server/auth";
import { filaDoSetor } from "@/server/posto";

export async function GET(req: Request) {
  const u = await usuarioAtual();
  if (!u) return NextResponse.json({ erro: "Sessão expirada" }, { status: 401 });
  const setor = Number(new URL(req.url).searchParams.get("setor"));
  const tarefa = Number(new URL(req.url).searchParams.get("tarefa"));
  if (tarefa) {
    const [t] = await sql`select setor_id from tarefas where id = ${tarefa}`;
    return NextResponse.json({ setor_id: t?.setor_id ?? null });
  }
  if (!setor) return NextResponse.json({ erro: "setor obrigatório" }, { status: 400 });
  const [fila, parada] = await Promise.all([
    filaDoSetor(setor),
    sql`select p.id, p.inicio, m.descricao from paradas p join motivos_parada m on m.id = p.motivo_id
        where p.setor_id = ${setor} and p.tarefa_id is null and p.fim is null limit 1`,
  ]);
  return NextResponse.json({ fila, parada: parada[0] ?? null, agora: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
