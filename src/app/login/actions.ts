"use server";
import { redirect } from "next/navigation";
import { ErroBloqueio, entrarComPin, entrarComSenha, sair } from "@/server/auth";

const tentar = async (fn: () => Promise<boolean>) => {
  try {
    return (await fn()) ? null : "invalido";
  } catch (e) {
    if (e instanceof ErroBloqueio) return e.message;
    throw e;
  }
};

export async function entrarAction(_: unknown, f: FormData) {
  const r = await tentar(() => entrarComSenha(String(f.get("login") ?? ""), String(f.get("senha") ?? "")));
  if (r) return { erro: r === "invalido" ? "Usuário ou senha inválidos" : r };
  const voltar = String(f.get("voltar") || "/");
  redirect(voltar.startsWith("/") && !voltar.startsWith("//") ? voltar : "/");
}

export async function entrarPinAction(_: unknown, f: FormData) {
  const r = await tentar(() => entrarComPin(String(f.get("matricula") ?? ""), String(f.get("pin") ?? "")));
  if (r) return { erro: r === "invalido" ? "Matrícula ou PIN inválidos" : r };
  const tarefa = Number(f.get("tarefa")) || 0;
  redirect(tarefa ? `/posto?tarefa=${tarefa}` : "/posto");
}

export async function sairAction() {
  await sair();
  redirect("/login");
}
