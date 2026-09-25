// MRP em baldes semanais.
//
// Diferenças em relação ao MRP de livro, por causa da realidade Moraes + Omie:
// 1) Conjuntos e peças fabricados sob pedido são "fantasmas": não têm estoque
//    próprio a compensar, a necessidade passa direto para os filhos.
// 2) O Omie só baixa os componentes quando a OP é CONCLUÍDA. Por isso toda OP
//    aberta continua gerando necessidade integral dos seus materiais.
// 3) Itens de supermercado repõem até o máximo quando o projetado cai abaixo
//    do mínimo (Kanban de reposição), e não por lote a lote.

import { diferencaDias, somarDias } from "./datas";
import { fatorFilho, niveisMaisBaixos } from "./estrutura";
import { agruparPor, arred, type ItemEng, type LinhaEstrutura } from "./tipos";

export interface DemandaMRP {
  item_id: number;
  quantidade: number;
  data: string;
}

export interface OpAbertaMRP {
  item_id: number;
  quantidade_total: number;
  quantidade_restante: number;
  data_necessidade: string;
  data_inicio: string | null;
}

export interface EntradaMRP {
  inicio: string; // segunda-feira do balde 0
  semanas: number;
  itens: ItemEng[];
  estrutura: LinhaEstrutura[];
  saldos: Map<number, number>;
  recebimentos: DemandaMRP[]; // compras em aberto
  demandas: DemandaMRP[]; // demanda independente (pedidos de venda)
  opsAbertas: OpAbertaMRP[];
}

export interface LinhaMRP {
  item_id: number;
  semana: number;
  bruta: number;
  recebimentos: number;
  estoque_projetado: number;
  liquida: number;
  recebimento_planejado: number;
  liberacao_planejada: number;
}

export interface SugestaoMRP {
  tipo: "compra" | "producao";
  item_id: number;
  quantidade: number;
  data_liberacao: string;
  data_necessidade: string;
  atrasada: boolean;
}

export interface ResultadoMRP {
  linhas: LinhaMRP[];
  sugestoes: SugestaoMRP[];
  avisos: string[];
}

export function ehFantasma(i: ItemEng): boolean {
  return i.origem === "fabricado" && i.politica === "sob_pedido" && i.tipo !== "produto";
}

export function semanasDeLeadTime(dias: number): number {
  return Math.ceil(Math.max(0, dias) / 7);
}

export function dimensionarLote(liquida: number, item: ItemEng): number {
  if (liquida <= 0) return 0;
  let q = Math.max(liquida, item.lote_minimo || 0);
  if (item.lote_multiplo > 0) q = Math.ceil(arred(q / item.lote_multiplo, 6)) * item.lote_multiplo;
  return arred(q);
}

export function calcularMRP(e: EntradaMRP): ResultadoMRP {
  const H = e.semanas;
  const avisos: string[] = [];
  const itens = new Map(e.itens.map((i) => [i.id, i]));
  const filhosPorPai = agruparPor(e.estrutura, (l) => l.pai_id);
  const llc = niveisMaisBaixos(e.itens.map((i) => i.id), e.estrutura);

  const balde = (data: string): number | null => {
    const b = Math.floor(diferencaDias(data, e.inicio) / 7);
    if (b >= H) return null;
    return Math.max(0, b);
  };
  const dataBalde = (b: number) => somarDias(e.inicio, 7 * b);

  const zeros = () => new Array<number>(H).fill(0);
  const bruta = new Map<number, number[]>();
  const receb = new Map<number, number[]>();
  const add = (m: Map<number, number[]>, id: number, b: number, q: number) => {
    let arr = m.get(id);
    if (!arr) m.set(id, (arr = zeros()));
    arr[b] += q;
  };

  for (const d of e.demandas) {
    const b = balde(d.data);
    if (b !== null) add(bruta, d.item_id, b, d.quantidade);
  }
  for (const r of e.recebimentos) {
    const b = balde(r.data);
    if (b !== null) add(receb, r.item_id, b, r.quantidade);
  }
  for (const op of e.opsAbertas) {
    const item = itens.get(op.item_id);
    if (!item) continue;
    const bFim = balde(op.data_necessidade);
    if (bFim !== null && op.quantidade_restante > 0) add(receb, op.item_id, bFim, op.quantidade_restante);
    // necessidade dependente: materiais da OP no balde de início
    const inicio = op.data_inicio ?? somarDias(op.data_necessidade, -item.lead_time_dias);
    const bIni = balde(inicio);
    if (bIni === null) continue;
    for (const l of filhosPorPai.get(op.item_id) ?? []) add(bruta, l.filho_id, bIni, op.quantidade_total * fatorFilho(l));
  }

  const ordem = [...e.itens].sort((a, b) => (llc.get(a.id) ?? 0) - (llc.get(b.id) ?? 0));
  const linhas: LinhaMRP[] = [];
  const sugestoes: SugestaoMRP[] = [];

  for (const item of ordem) {
    const g = bruta.get(item.id) ?? zeros();
    const filhos = filhosPorPai.get(item.id) ?? [];

    if (ehFantasma(item)) {
      // repassa a necessidade para os filhos no mesmo balde
      for (let b = 0; b < H; b++) {
        if (!g[b]) continue;
        for (const l of filhos) add(bruta, l.filho_id, b, g[b] * fatorFilho(l));
      }
      continue;
    }

    const r = receb.get(item.id) ?? zeros();
    const saldo = e.saldos.get(item.id) ?? 0;
    const supermercado = item.politica === "supermercado";
    const lt = semanasDeLeadTime(item.lead_time_dias);
    const liberacoes = zeros();
    let proj = saldo;
    let ativo = saldo !== 0 || g.some(Boolean) || r.some(Boolean);
    const linhasItem: LinhaMRP[] = [];

    for (let b = 0; b < H; b++) {
      proj = arred(proj + r[b] - g[b]);
      let liquida = 0;
      let lote = 0;
      if (supermercado && item.estoque_max > 0) {
        if (proj < item.estoque_min) {
          liquida = arred(item.estoque_max - proj);
          lote = dimensionarLote(liquida, item);
        }
      } else if (proj < item.estoque_seguranca) {
        liquida = arred(item.estoque_seguranca - proj);
        lote = dimensionarLote(liquida, item);
      }
      if (lote > 0) {
        ativo = true;
        proj = arred(proj + lote);
        const bLib = b - lt;
        const atrasada = bLib < 0;
        const bLibReal = Math.max(0, bLib);
        liberacoes[bLibReal] += lote;
        sugestoes.push({
          tipo: item.origem === "comprado" ? "compra" : "producao",
          item_id: item.id,
          quantidade: lote,
          data_liberacao: dataBalde(bLibReal),
          data_necessidade: dataBalde(b),
          atrasada,
        });
      }
      linhasItem.push({
        item_id: item.id,
        semana: b,
        bruta: arred(g[b]),
        recebimentos: arred(r[b]),
        estoque_projetado: proj,
        liquida,
        recebimento_planejado: lote,
        liberacao_planejada: 0,
      });
    }
    linhasItem.forEach((l, b) => (l.liberacao_planejada = arred(liberacoes[b])));
    if (ativo) linhas.push(...linhasItem);

    if (item.origem === "fabricado") {
      if (!filhos.length && liberacoes.some(Boolean)) avisos.push(`Item fabricado sem estrutura: ${item.codigo}`);
      for (let b = 0; b < H; b++) {
        if (!liberacoes[b]) continue;
        for (const l of filhos) add(bruta, l.filho_id, b, liberacoes[b] * fatorFilho(l));
      }
    }
  }

  const atrasadas = sugestoes.filter((s) => s.atrasada).length;
  if (atrasadas) avisos.push(`${atrasadas} sugestão(ões) já deveriam ter sido liberadas (lead time maior que o prazo)`);
  return { linhas, sugestoes, avisos };
}
