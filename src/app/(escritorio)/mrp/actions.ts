"use server";
import { exigir, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro } from "@/lib/acao";
import { converterSugestaoEmOP, enviarRequisicaoCompra, executarMRP } from "@/server/mrp";
import { reprogramar } from "@/server/programacao";

export async function rodarMRPAction() {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/mrp", async () => {
    const r = await executarMRP(u.id);
    return `MRP calculado: ${r.sugestoes} sugestões${r.avisos.length ? `, ${r.avisos.length} aviso(s)` : ""}`;
  });
}

export async function converterAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/mrp", async () => {
    const op = await converterSugestaoEmOP(inteiro(f, "sugestao_id"), u.id);
    await reprogramar();
    return `OP ${op.numero} criada a partir da sugestão`;
  });
}

export async function requisicaoAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/mrp", async () => {
    const ids = f.getAll("sugestao").map(Number).filter(Boolean);
    const r = await enviarRequisicaoCompra(ids, u.id);
    return `Requisição ${r.referencia} com ${r.itens} itens na fila de envio ao Omie`;
  });
}
