"use server";
import { exigir, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro, numero, texto } from "@/lib/acao";
import { alterarPrioridade, cancelarOP, criarOP, firmarOP, liberarOP, reexplodirOP } from "@/server/ops";
import { reprogramar } from "@/server/programacao";
import { ErroDominio } from "@/domain/tipos";

export async function novaOPAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/ops", async () => {
    const itemId = inteiro(f, "item_id");
    if (!itemId) throw new ErroDominio("Escolha o item");
    const data = texto(f, "data_necessidade");
    if (!data) throw new ErroDominio("Informe a data de necessidade");
    const op = await criarOP(
      { item_id: itemId, quantidade: numero(f, "quantidade"), data_necessidade: data, origem: "manual", prioridade: inteiro(f, "prioridade"), observacao: texto(f, "observacao") || null },
      u.id,
    );
    await reprogramar();
    return { destino: `/ops/${op.id}`, mensagem: `OP ${op.numero} criada${op.avisos.length ? ` com ${op.avisos.length} aviso(s) de cadastro` : ""}` };
  });
}

export async function liberarAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "op_id");
  await executar(`/ops/${id}`, async () => {
    const kit = await liberarOP(id, u.id, texto(f, "assumir_falta") || null);
    await reprogramar();
    return kit.completo ? "OP liberada para a produção" : "OP liberada com falta de material assumida";
  });
}

export async function firmarAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "op_id");
  await executar(`/ops/${id}`, async () => {
    await firmarOP(id, u.id);
    await reprogramar();
    return "OP firmada";
  });
}

export async function cancelarAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "op_id");
  await executar(`/ops/${id}`, async () => {
    await cancelarOP(id, u.id, texto(f, "motivo"));
    await reprogramar();
    return "OP cancelada";
  });
}

export async function prioridadeAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "op_id");
  await executar(`/ops/${id}`, async () => {
    await alterarPrioridade(id, inteiro(f, "prioridade"), texto(f, "data_necessidade") || null, u.id);
    await reprogramar();
    return "Prioridade e data atualizadas; programação recalculada";
  });
}

export async function reexplodirAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "op_id");
  await executar(`/ops/${id}`, async () => {
    const avisos = await reexplodirOP(id, u.id);
    await reprogramar();
    return `Estrutura recalculada${avisos.length ? ` (${avisos.length} avisos)` : ""}`;
  });
}
