import { redirect } from "next/navigation";
import { sql } from "@/lib/db";
import { usuarioAtual } from "@/server/auth";
import { PostoApp } from "./PostoApp";

export const dynamic = "force-dynamic";
export const metadata = { title: "Posto" };

export default async function Posto({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const u = await usuarioAtual();
  const sp = await searchParams;
  if (!u) redirect(`/login${sp.tarefa ? `?tarefa=${sp.tarefa}` : ""}`);
  const [setores, motivosParada, motivosRefugo] = await Promise.all([
    sql`select id, codigo, nome from setores where ativo order by sequencia`,
    sql`select id, codigo, descricao, tipo from motivos_parada where ativo order by codigo`,
    sql`select id, descricao from motivos_refugo where ativo order by codigo`,
  ]);
  return (
    <PostoApp
      usuario={{ id: u.id, nome: u.nome, setor_id: u.setor_id }}
      setores={setores as never}
      motivosParada={motivosParada as never}
      motivosRefugo={motivosRefugo as never}
      tarefaInicial={sp.tarefa ? Number(sp.tarefa) || null : null}
    />
  );
}
