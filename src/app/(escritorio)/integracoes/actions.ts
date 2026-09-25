"use server";
import { exigir } from "@/server/auth";
import { executar, inteiro, texto } from "@/lib/acao";
import { sql } from "@/lib/db";
import { executarSincronizacao } from "@/integrations/omie/sync";
import { reprogramar } from "@/server/programacao";
import { auditar } from "@/server/auditoria";

export async function sincronizarAction(f: FormData) {
  await exigir("admin", "pcp");
  await executar("/integracoes", async () => {
    const ent = texto(f, "entidade");
    const r = await executarSincronizacao({ forcar: ent ? [ent] : ["produtos", "estrutura", "estoque", "pedidos", "compras", "outbox"] });
    if (r.some((x) => x.ok)) await reprogramar();
    return r.map((x) => `${x.entidade}: ${x.ok ? "ok" : "erro"} (${x.mensagem})`).join(" · ");
  });
}

export async function outboxAction(f: FormData) {
  const u = await exigir("admin", "pcp");
  await executar("/integracoes", async () => {
    const id = inteiro(f, "id");
    const acao = texto(f, "acao");
    if (acao === "reenviar") await sql`update outbox set status = 'pendente', tentativas = 0, proxima_tentativa = now(), updated_at = now() where id = ${id}`;
    if (acao === "cancelar") await sql`update outbox set status = 'cancelado', updated_at = now() where id = ${id} and status <> 'enviado'`;
    await auditar(u.id, "outbox", id, acao);
    return acao === "reenviar" ? "Item volta para a fila" : "Envio cancelado";
  });
}
