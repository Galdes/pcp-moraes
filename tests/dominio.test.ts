import { describe, expect, it } from "vitest";
import { explodir, gerarTarefas, encontrarCiclos, niveisMaisBaixos } from "@/domain/estrutura";
import { calcularMRP, dimensionarLote } from "@/domain/mrp";
import { calcularKit } from "@/domain/kitting";
import { criarCalendario } from "@/domain/calendario";
import { cargaNecessaria, diaDoFim, programarFinito, type TarefaProg } from "@/domain/programacao";
import { calcularOEE, otd, pareto } from "@/domain/indicadores";
import { segundaDaSemana, deOmie, formatarOmie } from "@/domain/datas";
import type { ItemEng, LinhaEstrutura, OperacaoRoteiro } from "@/domain/tipos";

const item = (id: number, codigo: string, p: Partial<ItemEng> = {}): ItemEng => ({
  id,
  codigo,
  descricao: codigo,
  tipo: "peca",
  origem: "fabricado",
  politica: "sob_pedido",
  lead_time_dias: 0,
  estoque_seguranca: 0,
  estoque_min: 0,
  estoque_max: 0,
  lote_minimo: 0,
  lote_multiplo: 0,
  ...p,
});

// Máquina simplificada no formato Moraes
//  VIBRO (produto)
//   ├─ CJ BRACO (conjunto) x2
//   │    ├─ BRACO 200 (peça) x1 ── TUBO 50x50 (MP, comprado) 0,2 m com 5% de perda
//   │    └─ ENXADA (peça de supermercado) x3
//   ├─ CHASSI (peça) x1 ── TUBO 50x50 1,5 m
//   └─ PARAFUSO (comprado) x10
const itens = [
  item(1, "VIBRO", { tipo: "produto", lead_time_dias: 14 }),
  item(2, "CJ-BRACO", { tipo: "conjunto" }),
  item(3, "BRACO-200"),
  item(4, "ENXADA", { politica: "supermercado", estoque_min: 20, estoque_max: 60, lead_time_dias: 7 }),
  item(5, "CHASSI"),
  item(6, "TUBO-50", { tipo: "materia_prima", origem: "comprado", lead_time_dias: 14, lote_multiplo: 6 }),
  item(7, "PARAFUSO", { tipo: "componente_comprado", origem: "comprado", lead_time_dias: 7, lote_minimo: 500, estoque_seguranca: 100 }),
];
const mapa = new Map(itens.map((i) => [i.id, i]));
const estrutura: LinhaEstrutura[] = [
  { pai_id: 1, filho_id: 2, quantidade: 2, perda_pct: 0 },
  { pai_id: 1, filho_id: 5, quantidade: 1, perda_pct: 0 },
  { pai_id: 1, filho_id: 7, quantidade: 10, perda_pct: 0 },
  { pai_id: 2, filho_id: 3, quantidade: 1, perda_pct: 0 },
  { pai_id: 2, filho_id: 4, quantidade: 3, perda_pct: 0 },
  { pai_id: 3, filho_id: 6, quantidade: 0.2, perda_pct: 5 },
  { pai_id: 5, filho_id: 6, quantidade: 1.5, perda_pct: 0 },
  { pai_id: 4, filho_id: 6, quantidade: 0.1, perda_pct: 0 },
];
// setores: 1 corte, 2 solda, 3 montagem
const roteiros: OperacaoRoteiro[] = [
  { id: 1, item_id: 3, sequencia: 10, setor_id: 1, descricao: "Cortar", setup_min: 10, tempo_unit_min: 5 },
  { id: 2, item_id: 3, sequencia: 20, setor_id: 2, descricao: "Soldar", setup_min: 0, tempo_unit_min: 15 },
  { id: 3, item_id: 5, sequencia: 10, setor_id: 1, descricao: "Cortar", setup_min: 10, tempo_unit_min: 20 },
  { id: 4, item_id: 5, sequencia: 20, setor_id: 2, descricao: "Soldar", setup_min: 0, tempo_unit_min: 60 },
  { id: 5, item_id: 2, sequencia: 10, setor_id: 2, descricao: "Soldar conjunto", setup_min: 0, tempo_unit_min: 20 },
  { id: 6, item_id: 1, sequencia: 10, setor_id: 3, descricao: "Montar", setup_min: 0, tempo_unit_min: 120 },
];

describe("explosão da estrutura", () => {
  it("separa o que é fabricado na OP do que é material do kit", () => {
    const r = explodir(1, 2, mapa, estrutura);
    expect([...r.nos.keys()].sort()).toEqual([1, 2, 3, 5]);
    expect(r.nos.get(2)!.quantidade).toBe(4);
    expect(r.nos.get(3)!.quantidade).toBe(4);
    expect(r.nos.get(3)!.nivel).toBe(2);
    // tubo: braço 4 × 0,2 × 1,05 = 0,84 + chassi 2 × 1,5 = 3 → 3,84
    expect(r.materiais.get(6)).toBeCloseTo(3.84, 6);
    expect(r.materiais.get(4)).toBe(12); // enxada vem do supermercado
    expect(r.materiais.get(7)).toBe(20);
    expect(r.materiais.has(3)).toBe(false);
  });

  it("recusa estrutura circular", () => {
    expect(() => explodir(1, 1, mapa, [...estrutura, { pai_id: 3, filho_id: 2, quantidade: 1, perda_pct: 0 }])).toThrow(/circular/);
    expect(encontrarCiclos([...estrutura, { pai_id: 3, filho_id: 2, quantidade: 1, perda_pct: 0 }]).length).toBeGreaterThan(0);
    expect(encontrarCiclos(estrutura)).toEqual([]);
  });

  it("gera tarefas encadeadas: peça antes do conjunto, conjunto antes da montagem", () => {
    const ex = explodir(1, 2, mapa, estrutura);
    const { tarefas } = gerarTarefas(ex, roteiros, mapa);
    const t = (k: string) => tarefas.find((x) => x.chave === k)!;
    expect(tarefas).toHaveLength(6);
    expect(t("3:20").depende_de).toEqual(["3:10"]);
    expect(t("2:10").depende_de).toEqual(["3:20"]);
    expect(t("1:10").depende_de.sort()).toEqual(["2:10", "5:20"]);
    expect(t("3:10").tempo_previsto_min).toBe(10 + 5 * 4);
  });

  it("item sem roteiro é transparente para as dependências", () => {
    const ex = explodir(1, 1, mapa, estrutura);
    const semConjunto = roteiros.filter((r) => r.item_id !== 2);
    const { tarefas, avisos } = gerarTarefas(ex, semConjunto, mapa);
    expect(avisos.join()).toMatch(/CJ-BRACO não tem roteiro/);
    expect(tarefas.find((x) => x.chave === "1:10")!.depende_de.sort()).toEqual(["3:20", "5:20"]);
  });

  it("calcula o nível mais baixo de cada item", () => {
    const llc = niveisMaisBaixos(itens.map((i) => i.id), estrutura);
    expect(llc.get(1)).toBe(0);
    expect(llc.get(6)).toBe(3); // tubo aparece no nível 3 (vibro > cj > enxada > tubo)
  });
});

describe("MRP", () => {
  const base = {
    inicio: "2026-09-28",
    semanas: 8,
    itens,
    estrutura,
    saldos: new Map<number, number>([[4, 30], [7, 150], [6, 2]]),
    recebimentos: [],
    opsAbertas: [],
  };

  it("lote mínimo e múltiplo", () => {
    expect(dimensionarLote(3, itens[5])).toBe(6);
    expect(dimensionarLote(7, itens[5])).toBe(12);
    expect(dimensionarLote(50, itens[6])).toBe(500);
    expect(dimensionarLote(0, itens[6])).toBe(0);
  });

  it("explode pedido de venda até a compra com defasagem de lead time", () => {
    const r = calcularMRP({ ...base, demandas: [{ item_id: 1, quantidade: 2, data: "2026-10-26" }] });
    // Vibro: balde 4, LT 14 dias = 2 semanas → liberar OP no balde 2
    const opVibro = r.sugestoes.find((s) => s.item_id === 1)!;
    expect(opVibro).toMatchObject({ tipo: "producao", quantidade: 2, data_liberacao: "2026-10-12", data_necessidade: "2026-10-26" });
    // Parafuso: 20 no balde 2; saldo 150 − 20 = 130 ≥ SS 100 → nada
    expect(r.sugestoes.find((s) => s.item_id === 7)).toBeUndefined();
    // Enxada (supermercado): 12 no balde 2; 30 − 12 = 18 < mín 20 → repõe até 60 = 42
    const enx = r.sugestoes.find((s) => s.item_id === 4)!;
    expect(enx.quantidade).toBe(42);
    expect(enx.data_liberacao).toBe("2026-10-05"); // LT 1 semana
    // Tubo: vibro 3,84 no balde 2 + enxada 42 × 0,1 = 4,2 no balde 1
    const tubos = r.sugestoes.filter((s) => s.item_id === 6);
    const linhasTubo = r.linhas.filter((l) => l.item_id === 6);
    expect(linhasTubo[1].bruta).toBeCloseTo(4.2, 6);
    expect(linhasTubo[2].bruta).toBeCloseTo(3.84, 6);
    expect(tubos.every((s) => s.quantidade % 6 === 0)).toBe(true);
    expect(tubos[0].atrasada).toBe(true); // precisa no balde 1, LT de 2 semanas
  });

  it("OP aberta cobre o pedido e mantém a necessidade dos materiais até concluir", () => {
    const r = calcularMRP({
      ...base,
      demandas: [{ item_id: 1, quantidade: 2, data: "2026-10-26" }],
      opsAbertas: [{ item_id: 1, quantidade_total: 2, quantidade_restante: 2, data_necessidade: "2026-10-26", data_inicio: "2026-10-12" }],
    });
    expect(r.sugestoes.find((s) => s.item_id === 1)).toBeUndefined();
    expect(r.linhas.filter((l) => l.item_id === 4)[2].bruta).toBe(12);
  });

  it("estoque de segurança dispara compra", () => {
    const r = calcularMRP({ ...base, demandas: [], saldos: new Map([[7, 80]]) });
    const p = r.sugestoes.find((s) => s.item_id === 7)!;
    expect(p.quantidade).toBe(500);
    expect(p.tipo).toBe("compra");
  });
});

describe("kitting", () => {
  it("desconta o que já está comprometido com outras OPs", () => {
    const k = calcularKit(
      [
        { item_id: 6, qtd: 4 },
        { item_id: 7, qtd: 20 },
      ],
      new Map([
        [6, 10],
        [7, 25],
      ]),
      new Map([[7, 10]]),
    );
    expect(k.completo).toBe(false);
    expect(k.linhas[0]).toMatchObject({ item_id: 7, disponivel: 15, falta: 5 });
    expect(k.linhas[1].falta).toBe(0);
  });
});

describe("programação", () => {
  const setores = [
    { id: 1, recursos: 1, horas_turno: 8, eficiencia: 1 },
    { id: 2, recursos: 2, horas_turno: 8, eficiencia: 1 },
  ];
  const cal = criarCalendario(new Map(), []);
  const t = (id: number, setor: number, min: number, p: Partial<TarefaProg> = {}): TarefaProg => ({
    id,
    op_id: 1,
    setor_id: setor,
    tempo_restante_min: min,
    status: "pendente",
    deps: [],
    fila_manual: null,
    op_prioridade: 0,
    op_data_necessidade: "2026-10-30",
    nivel: 0,
    sequencia: 10,
    ...p,
  });

  it("respeita dependência e capacidade finita (sexta → segunda)", () => {
    // 2026-09-25 é sexta
    const r = programarFinito([t(1, 1, 360), t(2, 1, 240, { deps: [1] })], setores, cal, { hoje: "2026-09-25" });
    expect(r.get(1)!.fim).toBeCloseTo(0.75, 6);
    // restam 120 min na sexta; os outros 120 vão para segunda (dia 3)
    expect(r.get(2)!.inicio).toBeCloseTo(0.75, 6);
    expect(r.get(2)!.fim).toBeCloseTo(3.25, 6);
    expect(diaDoFim("2026-09-25", r.get(2)!.fim)).toBe("2026-09-28");
  });

  it("setor com 2 recursos faz tarefas em paralelo", () => {
    const r = programarFinito([t(1, 2, 480), t(2, 2, 480)], setores, cal, { hoje: "2026-09-28" });
    expect(r.get(1)!.fim).toBeCloseTo(1, 6);
    expect(r.get(2)!.fim).toBeCloseTo(1, 6);
  });

  it("indisponibilidade (NR12) tira um recurso do setor", () => {
    const calNr12 = criarCalendario(new Map(), [{ setor_id: 2, inicio: "2026-09-28", fim: "2026-09-28", recursos_indisponiveis: 1 }]);
    const r = programarFinito([t(1, 2, 480), t(2, 2, 480)], setores, calNr12, { hoje: "2026-09-28" });
    expect(Math.max(r.get(1)!.fim, r.get(2)!.fim)).toBeCloseTo(2, 6);
  });

  it("prioridade manual e data prometida definem a ordem", () => {
    const r = programarFinito(
      [
        t(1, 1, 480, { op_id: 1, op_data_necessidade: "2026-10-01" }),
        t(2, 1, 480, { op_id: 2, op_data_necessidade: "2026-10-20" }),
        t(3, 1, 480, { op_id: 3, op_data_necessidade: "2026-10-25", fila_manual: 1 }),
      ],
      setores,
      cal,
      { hoje: "2026-09-28" },
    );
    expect(r.get(3)!.fim).toBeCloseTo(1, 6);
    expect(r.get(1)!.fim).toBeCloseTo(2, 6);
    expect(r.get(2)!.fim).toBeCloseTo(3, 6);
  });

  it("OP só firmada entra depois das liberadas, mesmo com promessa mais cedo", () => {
    const r = programarFinito(
      [t(1, 1, 480, { op_id: 1, op_data_necessidade: "2026-10-01", op_liberada: false }), t(2, 1, 480, { op_id: 2, op_data_necessidade: "2026-10-20", op_liberada: true })],
      setores,
      cal,
      { hoje: "2026-09-28" },
    );
    expect(r.get(2)!.fim).toBeCloseTo(1, 6);
    expect(r.get(1)!.fim).toBeCloseTo(2, 6);
  });

  it("carga necessária mostra sobrecarga na semana certa", () => {
    const c = cargaNecessaria(
      [t(1, 1, 3000, { op_data_necessidade: "2026-10-02" }), t(2, 1, 600, { op_data_necessidade: "2026-10-16" })],
      setores,
      cal,
      "2026-09-28",
      4,
    );
    const s1 = c.filter((x) => x.setor_id === 1);
    expect(s1[0].capacidade_min).toBe(2400);
    expect(s1[0].carga_min).toBe(3000); // 3000 min para entregar sexta: não cabe
    expect(s1[0].atrasada_min).toBe(3000); // já deveria ter começado
    expect(s1[2].carga_min).toBe(600);
  });
});

describe("indicadores", () => {
  it("OEE: disponibilidade × performance × qualidade", () => {
    const r = calcularOEE({
      capacidade_min: 1080,
      tempo_apontado_min: 432,
      paradas_nao_planejadas_min: 108,
      producao_padrao_min: 345.6,
      qtd_boa: 90,
      qtd_total: 100,
    });
    expect(r.disponibilidade).toBe(0.8);
    expect(r.performance).toBe(0.8);
    expect(r.qualidade).toBe(0.9);
    expect(r.oee).toBe(0.576);
    expect(r.utilizacao).toBe(0.5);
  });

  it("pareto e OTD", () => {
    const p = pareto([
      { chave: "Setup", valor: 30 },
      { chave: "Quebra", valor: 60 },
      { chave: "Setup", valor: 10 },
    ]);
    expect(p[0]).toMatchObject({ chave: "Quebra", pct: 0.6 });
    expect(p[1].pct_acumulado).toBe(1);
    expect(otd([{ data_necessidade: "2026-10-01", concluida_em_data: "2026-10-01" }, { data_necessidade: "2026-10-01", concluida_em_data: "2026-10-02" }])).toBe(0.5);
  });

  it("datas", () => {
    expect(segundaDaSemana("2026-09-27")).toBe("2026-09-21");
    expect(formatarOmie("2026-09-05")).toBe("05/09/2026");
    expect(deOmie("05/09/2026")).toBe("2026-09-05");
  });
});
