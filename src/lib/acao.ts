import "server-only";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ErroDominio } from "@/domain/tipos";
import { ErroOmie } from "@/integrations/omie/cliente";

/**
 * Executa uma ação de formulário e volta para a página com mensagem de
 * sucesso ou erro (?ok= / ?erro=). Erros de regra de negócio são mostrados
 * ao usuário; erros inesperados são registrados e mostrados de forma genérica.
 */
export async function executar(
  destino: string,
  fn: () => Promise<string | void | { mensagem: string; destino: string }>,
): Promise<never> {
  let url: string;
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    const dest = typeof r === "object" && r ? r.destino : destino;
    const msg = typeof r === "object" && r ? r.mensagem : r;
    url = `${dest}${dest.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg || "Salvo")}`;
  } catch (e) {
    const conhecido = e instanceof ErroDominio || e instanceof ErroOmie || (e instanceof Error && e.message.startsWith("Sem permissão"));
    if (!conhecido) console.error("[acao]", destino, e);
    const msg = conhecido ? (e as Error).message : traduzirErroBanco(e) ?? "Erro inesperado. Tente de novo ou avise o administrador.";
    url = `${destino}${destino.includes("?") ? "&" : "?"}erro=${encodeURIComponent(msg)}`;
  }
  redirect(url);
}

function traduzirErroBanco(e: unknown): string | null {
  const err = e as { code?: string; constraint_name?: string; detail?: string };
  if (err?.code === "23505") return `Já existe um registro com esse valor (${err.detail ?? err.constraint_name ?? "duplicado"})`;
  if (err?.code === "23503") return "Registro está em uso por outro cadastro e não pode ser removido/alterado assim";
  if (err?.code === "23514") return "Valor fora das regras do cadastro (verifique os campos)";
  if (err?.code === "22P02") return "Valor inválido em algum campo numérico";
  return null;
}

export const texto = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
export const numero = (f: FormData, k: string, padrao = 0) => {
  const v = texto(f, k).replace(/\./g, "").replace(",", ".");
  if (v === "") return padrao;
  const n = Number(v);
  if (Number.isNaN(n)) throw new ErroDominio(`Campo "${k}" não é um número válido`);
  return n;
};
export const inteiro = (f: FormData, k: string, padrao = 0) => Math.round(numero(f, k, padrao));
