// Explosão da estrutura de produto e geração das tarefas de uma OP.
//
// Regra central (desenho Moraes): dentro de uma OP, só viram tarefas de
// fabricação os itens FABRICADOS e SOB PEDIDO. Itens comprados e itens de
// SUPERMERCADO (peças comuns repostas por Kanban) viram MATERIAL do kit:
// a OP consome do estoque, não fabrica.

import { agruparPor, arred, ErroDominio, type ItemEng, type LinhaEstrutura, type OperacaoRoteiro } from "./tipos";

export interface NoExplosao {
  item_id: number;
  quantidade: number;
  nivel: number; // maior profundidade em que o item aparece
  filhos: Set<number>; // filhos que também são fabricados na OP
}

export interface ResultadoExplosao {
  nos: Map<number, NoExplosao>;
  materiais: Map<number, number>; // item_id -> quantidade total necessária
  avisos: string[];
}

export function fatorFilho(l: LinhaEstrutura): number {
  return l.quantidade * (1 + l.perda_pct / 100);
}

export function fabricadoDentroDaOP(item: ItemEng): boolean {
  return item.origem === "fabricado" && item.politica === "sob_pedido";
}

export function explodir(
  raizId: number,
  quantidade: number,
  itens: Map<number, ItemEng>,
  estrutura: LinhaEstrutura[],
): ResultadoExplosao {
  const filhosPorPai = agruparPor(estrutura, (l) => l.pai_id);
  const nos = new Map<number, NoExplosao>();
  const materiais = new Map<number, number>();
  const avisos = new Set<string>();

  const raiz = itens.get(raizId);
  if (!raiz) throw new ErroDominio(`Item ${raizId} não encontrado`);
  if (raiz.origem !== "fabricado") throw new ErroDominio(`${raiz.codigo} é comprado: não pode ter OP`);

  const visitar = (itemId: number, qtd: number, nivel: number, caminho: number[]) => {
    if (caminho.includes(itemId)) {
      const cod = [...caminho, itemId].map((i) => itens.get(i)?.codigo ?? i).join(" → ");
      throw new ErroDominio(`Estrutura circular: ${cod}`);
    }
    const item = itens.get(itemId)!;
    let no = nos.get(itemId);
    if (!no) {
      no = { item_id: itemId, quantidade: 0, nivel, filhos: new Set() };
      nos.set(itemId, no);
    }
    no.quantidade += qtd;
    no.nivel = Math.max(no.nivel, nivel);

    const linhas = filhosPorPai.get(itemId) ?? [];
    if (linhas.length === 0 && item.tipo !== "peca") {
      avisos.add(`${item.codigo} é fabricado mas não tem estrutura cadastrada`);
    }
    for (const l of linhas) {
      const filho = itens.get(l.filho_id);
      if (!filho) throw new ErroDominio(`Componente ${l.filho_id} de ${item.codigo} não encontrado`);
      const q = qtd * fatorFilho(l);
      if (fabricadoDentroDaOP(filho)) {
        no.filhos.add(filho.id);
        visitar(filho.id, q, nivel + 1, [...caminho, itemId]);
      } else {
        materiais.set(filho.id, (materiais.get(filho.id) ?? 0) + q);
      }
    }
  };

  visitar(raizId, quantidade, 0, []);

  for (const no of nos.values()) no.quantidade = arred(no.quantidade);
  for (const [k, v] of materiais) materiais.set(k, arred(v));
  return { nos, materiais, avisos: [...avisos] };
}

export interface TarefaGerada {
  chave: string; // identificador temporário antes de gravar no banco
  item_id: number;
  roteiro_id: number;
  setor_id: number;
  sequencia: number;
  nivel: number;
  descricao: string;
  quantidade: number;
  tempo_previsto_min: number;
  depende_de: string[];
}

export function gerarTarefas(
  explosao: ResultadoExplosao,
  roteiros: OperacaoRoteiro[],
  itens: Map<number, ItemEng>,
): { tarefas: TarefaGerada[]; avisos: string[] } {
  const porItem = agruparPor(roteiros, (r) => r.item_id);
  const avisos: string[] = [];
  const tarefas: TarefaGerada[] = [];
  const opsDoNo = new Map<number, TarefaGerada[]>();

  for (const no of explosao.nos.values()) {
    const ops = [...(porItem.get(no.item_id) ?? [])].sort((a, b) => a.sequencia - b.sequencia);
    if (ops.length === 0) {
      avisos.push(`${itens.get(no.item_id)?.codigo} não tem roteiro: não gera tarefa (tempo não será programado)`);
    }
    const geradas = ops.map<TarefaGerada>((op, i) => ({
      chave: `${no.item_id}:${op.sequencia}`,
      item_id: no.item_id,
      roteiro_id: op.id,
      setor_id: op.setor_id,
      sequencia: op.sequencia,
      nivel: no.nivel,
      descricao: op.descricao,
      quantidade: no.quantidade,
      tempo_previsto_min: arred(op.setup_min + op.tempo_unit_min * no.quantidade, 2),
      depende_de: i > 0 ? [`${no.item_id}:${ops[i - 1].sequencia}`] : [],
    }));
    opsDoNo.set(no.item_id, geradas);
    tarefas.push(...geradas);
  }

  // Última operação "efetiva" de um nó. Item sem roteiro é transparente:
  // quem depende dele passa a depender das últimas operações dos filhos.
  const memo = new Map<number, string[]>();
  const ultimas = (itemId: number): string[] => {
    const m = memo.get(itemId);
    if (m) return m;
    const ops = opsDoNo.get(itemId) ?? [];
    const r = ops.length
      ? [ops[ops.length - 1].chave]
      : [...(explosao.nos.get(itemId)?.filhos ?? [])].flatMap(ultimas);
    memo.set(itemId, r);
    return r;
  };

  for (const no of explosao.nos.values()) {
    const ops = opsDoNo.get(no.item_id) ?? [];
    if (!ops.length) continue;
    const primeira = ops[0];
    for (const f of no.filhos) primeira.depende_de.push(...ultimas(f));
    primeira.depende_de = [...new Set(primeira.depende_de)];
  }

  return { tarefas, avisos };
}

/** Low-level code: nível mais profundo em que cada item aparece em qualquer estrutura. */
export function niveisMaisBaixos(itensIds: number[], estrutura: LinhaEstrutura[]): Map<number, number> {
  const llc = new Map<number, number>(itensIds.map((i) => [i, 0]));
  for (let iter = 0; iter <= itensIds.length + 1; iter++) {
    let mudou = false;
    for (const l of estrutura) {
      const p = llc.get(l.pai_id) ?? 0;
      if ((llc.get(l.filho_id) ?? 0) < p + 1) {
        llc.set(l.filho_id, p + 1);
        mudou = true;
      }
    }
    if (!mudou) return llc;
  }
  throw new ErroDominio("Estrutura circular detectada no cálculo de níveis");
}

/** Detecta ciclos em toda a base de estruturas (usado na tela de qualidade de dados). */
export function encontrarCiclos(estrutura: LinhaEstrutura[]): number[][] {
  const filhos = agruparPor(estrutura, (l) => l.pai_id);
  const estado = new Map<number, 1 | 2>();
  const ciclos: number[][] = [];
  const pilha: number[] = [];
  const dfs = (n: number) => {
    estado.set(n, 1);
    pilha.push(n);
    for (const l of filhos.get(n) ?? []) {
      const e = estado.get(l.filho_id);
      if (e === 1) ciclos.push([...pilha.slice(pilha.indexOf(l.filho_id)), l.filho_id]);
      else if (!e) dfs(l.filho_id);
    }
    pilha.pop();
    estado.set(n, 2);
  };
  for (const p of filhos.keys()) if (!estado.has(p)) dfs(p);
  return ciclos;
}
