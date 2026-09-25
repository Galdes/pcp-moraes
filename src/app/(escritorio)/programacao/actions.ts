"use server";
import { exigir, PODE_APROVAR, PODE_LIDERAR, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro, texto } from "@/lib/acao";
import { aprovarPrograma, moverNaFila, reprogramar } from "@/server/programacao";
import { ErroDominio } from "@/domain/tipos";

export async function reprogramarAction() {
  await exigir(...PODE_PLANEJAR);
  await executar("/programacao", async () => {
    const r = await reprogramar();
    return `Programação recalculada: ${r.tarefas} etapas de ${r.ops} OPs${r.atrasadas ? `; ${r.atrasadas} OP(s) terminam depois da promessa` : ""}`;
  });
}

export async function moverAction(f: FormData) {
  const u = await exigir(...PODE_LIDERAR);
  const setor = texto(f, "setor");
  await executar(`/programacao?setor=${setor}`, async () => {
    const d = texto(f, "direcao");
    if (!["subir", "descer", "topo", "limpar"].includes(d)) throw new ErroDominio("Movimento inválido");
    await moverNaFila(inteiro(f, "tarefa_id"), d as "subir", u.id);
    return "Fila atualizada";
  });
}

export async function aprovarAction(f: FormData) {
  const u = await exigir(...PODE_APROVAR);
  await executar("/programacao", async () => {
    await reprogramar();
    const r = await aprovarPrograma(texto(f, "semana"), u.id, texto(f, "observacao") || undefined);
    return `Programa da semana aprovado com ${r.tarefas} etapas. Dentro dele o PCP libera sem nova aprovação.`;
  });
}
