// Conferência de estoque (kitting) antes de liberar uma OP.
// Disponível = saldo do Omie − o que já está comprometido com OPs liberadas
// e ainda não concluídas (o Omie só baixa na conclusão).

import { arred } from "./tipos";

export interface LinhaKit {
  item_id: number;
  necessario: number;
  saldo: number;
  comprometido: number;
  disponivel: number;
  falta: number;
}

export function calcularKit(
  necessidades: { item_id: number; qtd: number }[],
  saldos: Map<number, number>,
  comprometido: Map<number, number>,
): { linhas: LinhaKit[]; completo: boolean } {
  const linhas = necessidades.map((n) => {
    const saldo = saldos.get(n.item_id) ?? 0;
    const comp = comprometido.get(n.item_id) ?? 0;
    const disponivel = arred(Math.max(0, saldo - comp));
    return {
      item_id: n.item_id,
      necessario: arred(n.qtd),
      saldo,
      comprometido: arred(comp),
      disponivel,
      falta: arred(Math.max(0, n.qtd - disponivel)),
    };
  });
  linhas.sort((a, b) => b.falta - a.falta || a.item_id - b.item_id);
  return { linhas, completo: linhas.every((l) => l.falta === 0) };
}
