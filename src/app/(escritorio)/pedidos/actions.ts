"use server";
import { exigir, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro, numero, texto } from "@/lib/acao";
import { criarOPDoPedido } from "@/server/ops";
import { reprogramar } from "@/server/programacao";
import { sql, type Sql } from "@/lib/db";
import { ErroDominio } from "@/domain/tipos";
import { auditar } from "@/server/auditoria";

export async function gerarOPAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/pedidos", async () => {
    const op = await criarOPDoPedido(inteiro(f, "pedido_item_id"), u.id);
    await reprogramar();
    return { destino: `/ops/${op.id}`, mensagem: `OP ${op.numero} gerada a partir do pedido` };
  });
}

/** Pedido manual: para quando a integração com o Omie ainda não está ativa. */
export async function novoPedidoAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/pedidos", async () => {
    const numeroPed = texto(f, "numero");
    const cliente = texto(f, "cliente");
    const entrega = texto(f, "data_entrega");
    const itemId = inteiro(f, "item_id");
    if (!numeroPed || !cliente || !entrega || !itemId) throw new ErroDominio("Preencha número, cliente, item e data de entrega");
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [p] = await t`insert into pedidos_venda (numero, cliente, data_entrega) values (${numeroPed}, ${cliente}, ${entrega}) returning id`;
      await t`insert into pedido_itens (pedido_id, item_id, quantidade) values (${p.id}, ${itemId}, ${numero(f, "quantidade", 1)})`;
      await auditar(u.id, "pedido", p.id as number, "criado_manual", undefined, t);
    });
    return `Pedido ${numeroPed} cadastrado`;
  });
}

export async function statusPedidoAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/pedidos", async () => {
    const st = texto(f, "status");
    if (!["aberto", "atendido", "cancelado"].includes(st)) throw new ErroDominio("Status inválido");
    await sql`update pedidos_venda set status = ${st}, updated_at = now() where id = ${inteiro(f, "pedido_id")} and omie_id is null`;
    await auditar(u.id, "pedido", inteiro(f, "pedido_id"), `status:${st}`);
    return "Pedido atualizado";
  });
}
