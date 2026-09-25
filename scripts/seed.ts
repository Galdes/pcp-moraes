// Carga inicial.
//  - Sempre: setores, motivos de parada/refugo e usuários iniciais.
//  - Com --demo: estrutura de demonstração do CA VIBRO 810 (códigos das peças
//    tirados do quadro "Moraes | Controle Produtivo" no Monday; quantidades,
//    matérias-primas e tempos são ILUSTRATIVOS), pedidos, OPs e histórico de
//    apontamentos para o painel ter o que mostrar.
//
// Em produção a estrutura e os produtos vêm do Omie; rode sem --demo.

import bcrypt from "bcryptjs";
import { sql } from "../src/lib/db";
import { hojeNoFuso, somarDias, segundaDaSemana } from "../src/domain/datas";

const DEMO = process.argv.includes("--demo");
const SENHA_INICIAL = process.env.SENHA_INICIAL ?? "trocar123";

async function base() {
  const setores = [
    ["CORTE", "Corte de tubos", 10, 1, false],
    ["FURACAO", "Furação", 20, 2, false],
    ["SOLDA", "Solda", 30, 3, true],
    ["USINAGEM", "Usinagem", 40, 1, false],
    ["PINTURA", "Pintura", 50, 1, false],
    ["MONTAGEM", "Montagem", 60, 2, false],
  ] as const;
  for (const [codigo, nome, seq, rec, garg] of setores) {
    await sql`insert into setores (codigo, nome, sequencia, recursos, horas_turno, eficiencia, eh_gargalo)
              values (${codigo}, ${nome}, ${seq}, ${rec}, 8.8, 0.85, ${garg}) on conflict (codigo) do nothing`;
  }

  // códigos no padrão da planilha de OEE do curso (100 planejadas, 200 setup, 300 quebras...)
  const paradas = [
    ["100", "Refeição", "planejada"],
    ["101", "Pausa no turno", "planejada"],
    ["102", "Reunião / DDS", "planejada"],
    ["200", "Setup / troca de ferramenta", "setup"],
    ["201", "Limpeza de equipamento", "setup"],
    ["300", "Quebra de máquina", "quebra"],
    ["301", "Falta de energia / ar comprimido", "quebra"],
    ["302", "Máquina em adequação NR12", "quebra"],
    ["400", "Falta de matéria-prima", "falta_material"],
    ["401", "Aguardando peça de outro setor", "falta_material"],
    ["500", "Retrabalho", "qualidade"],
    ["501", "Aguardando inspeção / liberação", "qualidade"],
    ["600", "Aguardando aprovação da diretoria", "organizacional"],
    ["601", "Falta de desenho / informação técnica", "organizacional"],
    ["602", "Falta de operador", "organizacional"],
  ];
  for (const [codigo, descricao, tipo] of paradas)
    await sql`insert into motivos_parada (codigo, descricao, tipo) values (${codigo}, ${descricao}, ${tipo}) on conflict (codigo) do nothing`;

  const refugos = [
    ["R1", "Medida fora do desenho"],
    ["R2", "Erro de corte"],
    ["R3", "Solda com defeito"],
    ["R4", "Furação fora de posição"],
    ["R5", "Material com defeito"],
    ["R6", "Defeito de pintura"],
  ];
  for (const [codigo, descricao] of refugos)
    await sql`insert into motivos_refugo (codigo, descricao) values (${codigo}, ${descricao}) on conflict (codigo) do nothing`;

  const senha = await bcrypt.hash(SENHA_INICIAL, 10);
  const pin = await bcrypt.hash("1234", 10);
  const setorId = async (c: string) => (await sql`select id from setores where codigo = ${c}`)[0].id as number;
  const usuarios: [string, string, string, string | null, boolean][] = [
    ["Administrador ESTG", "admin", "admin", null, false],
    ["Fernando (Diretoria)", "fernando", "diretoria", null, false],
    ["PCP Moraes", "pcp", "pcp", null, false],
    ["Cristiano (Engenharia)", "cristiano", "visualizador", null, false],
    ["Líder da Solda", "lider.solda", "lider", "SOLDA", false],
    ["Operador Corte", "1001", "operador", "CORTE", true],
    ["Operador Furação", "1002", "operador", "FURACAO", true],
    ["Soldador 1", "1003", "operador", "SOLDA", true],
    ["Operador Torno", "1004", "operador", "USINAGEM", true],
    ["Pintor", "1005", "operador", "PINTURA", true],
    ["Montador 1", "1006", "operador", "MONTAGEM", true],
  ];
  for (const [nome, login, perfil, setor, operador] of usuarios) {
    await sql`insert into usuarios (nome, login, senha_hash, pin_hash, perfil, setor_id)
              values (${nome}, ${login}, ${operador ? null : senha}, ${operador ? pin : null}, ${perfil}::perfil_usuario,
                      ${setor ? await setorId(setor) : null})
              on conflict (login) do nothing`;
  }
  console.log(`base: setores, motivos e usuários (senha inicial "${SENHA_INICIAL}", PIN dos operadores "1234")`);
}

type Linha = [string, string, string, string, string?, Record<string, number>?];

async function demo() {
  const hoje = hojeNoFuso();
  // [codigo, descricao, tipo, origem/politica, unidade, parâmetros]
  const itens: Linha[] = [
    ["01.10.20.399", "CA VIBRO 810 03U-0,90M-07ENX-BR02,40M", "produto", "fabricado", "UN", { lead_time_dias: 15 }],
    ["01.10.20.412", "CA VIBRO 810 05U-0,90M-11ENX-BR04,00M (variante demo)", "produto", "fabricado", "UN", { lead_time_dias: 20 }],
    // conjuntos
    ["01.10.10.008", "CJ PORTA FERRAMENTAS 100 X 100 X 2400", "conjunto", "fabricado"],
    ["01.10.10.004", "CJ BRAÇO DO PANTOGRAFO 50 X 50", "conjunto", "fabricado"],
    ["01.10.10.013", "CJ DO MANCAL 95X67", "conjunto", "fabricado"],
    ["01.10.10.015", "CJ UNIDADE VIBRO", "conjunto", "fabricado"],
    ["01.10.10.009", "CJ HASTE 32 X 10 ENX 9", "conjunto", "fabricado"],
    ["01.10.10.022", "CJ RODA REGULAGEM DIR", "conjunto", "fabricado"],
    ["01.10.10.023", "CJ RODA REGULAGEM ESQ", "conjunto", "fabricado"],
    // peças sob pedido
    ["01.10.40.004", "CHASSI", "peca", "fabricado"],
    ["01.10.40.300", "PORTA-FERRAMENTAS 100 X 100 X 2400 MM", "peca", "fabricado"],
    ["01.10.03.230", "ENGATE SUP TB 100", "peca", "fabricado"],
    ["01.10.03.231", "ENGATE INF TB 100", "peca", "fabricado"],
    ["01.10.01.002", "FIXADOR ESQ", "peca", "fabricado"],
    ["01.10.01.004", "LONGARINA 585", "peca", "fabricado"],
    ["01.10.01.005", "BRAÇO DO PANTOGRAFO 500 MM", "peca", "fabricado"],
    ["01.10.01.006", "GARRA DIREITA", "peca", "fabricado"],
    ["01.10.01.007", "GARRA ESQUERDA", "peca", "fabricado"],
    ["01.10.01.008", "BRAÇO 50 X 50 X 200 MM", "peca", "fabricado"],
    ["01.10.01.009", "BRAÇO 50 X 50 X 300 MM", "peca", "fabricado"],
    ["01.10.01.270", "TORRE DIR", "peca", "fabricado"],
    ["01.10.01.271", "TORRE ESQ", "peca", "fabricado"],
    ["01.10.40.005", "BRAÇO DO PANTOGRAFO 50 X 50 MM", "peca", "fabricado"],
    ["01.10.40.006", "EIXO DA RODA", "peca", "fabricado"],
    ["01.10.60.002", "BRAÇO DE REGULAGEM", "peca", "fabricado"],
    ["01.10.70.004", "EIXO", "peca", "fabricado"],
    // peças comuns: supermercado (Kanban de reposição)
    ["01.10.60.011", 'ENXADA 229 X 5 (9 X 3/16") F', "peca", "supermercado", "UN", { estoque_min: 30, estoque_max: 90, lead_time_dias: 5 }],
    ["01.10.70.002", "BUCHA INTERNA 51 MM", "peca", "supermercado", "UN", { estoque_min: 20, estoque_max: 60, lead_time_dias: 5 }],
    ["01.10.70.003", "BUCHA 42 X 50 MM", "peca", "supermercado", "UN", { estoque_min: 20, estoque_max: 60, lead_time_dias: 5 }],
    ["01.10.70.008", "BUCHA 22 X 23 MM", "peca", "supermercado", "UN", { estoque_min: 40, estoque_max: 120, lead_time_dias: 5 }],
    ["01.10.60.001", "ADAPTADOR 50X50X6MM", "peca", "supermercado", "UN", { estoque_min: 20, estoque_max: 60, lead_time_dias: 3 }],
    ["01.10.60.003", "ADAPTADOR 50X50X40MM", "peca", "supermercado", "UN", { estoque_min: 20, estoque_max: 60, lead_time_dias: 3 }],
    ["05.10.03.032", "SEPARADOR DA TORRE Ø51X 55 MM", "peca", "supermercado", "UN", { estoque_min: 20, estoque_max: 60, lead_time_dias: 5 }],
    ["01.10.60.010", "CUBO 95X67", "peca", "supermercado", "UN", { estoque_min: 6, estoque_max: 18, lead_time_dias: 5 }],
    // comprados (códigos ilustrativos)
    ["MP-TB100", "TUBO QUADRADO 100 X 100 X 4,75 MM", "materia_prima", "comprado", "M", { lead_time_dias: 10, lote_multiplo: 6 }],
    ["MP-TB50", "TUBO QUADRADO 50 X 50 X 3,00 MM", "materia_prima", "comprado", "M", { lead_time_dias: 10, lote_multiplo: 6, estoque_seguranca: 12 }],
    ["MP-CH316", 'CHAPA AÇO 3/16" (4,75 MM)', "materia_prima", "comprado", "KG", { lead_time_dias: 7, lote_minimo: 200, estoque_seguranca: 50 }],
    ["MP-CH14", 'CHAPA AÇO 1/4" (6,35 MM)', "materia_prima", "comprado", "KG", { lead_time_dias: 7, lote_minimo: 200, estoque_seguranca: 50 }],
    ["MP-BR32", "BARRA REDONDA SAE 1045 Ø 32 MM", "materia_prima", "comprado", "M", { lead_time_dias: 14, lote_multiplo: 6 }],
    ["MP-BR55", "BARRA REDONDA SAE 1045 Ø 55 MM", "materia_prima", "comprado", "M", { lead_time_dias: 14, lote_multiplo: 6 }],
    ["CP-TINTA", "TINTA ESMALTE SINTÉTICO VERMELHO", "componente_comprado", "comprado", "L", { lead_time_dias: 5, estoque_seguranca: 10 }],
    ["CP-KITFIX", "KIT FIXAÇÃO VIBRO (PARAFUSOS/PORCAS)", "componente_comprado", "comprado", "UN", { lead_time_dias: 7, estoque_seguranca: 3 }],
    ["CP-6206", "ROLAMENTO 6206 2RS", "componente_comprado", "comprado", "UN", { lead_time_dias: 14, estoque_seguranca: 8 }],
    ["CP-PNEU", "RODA COM PNEU 6.50-16", "componente_comprado", "comprado", "UN", { lead_time_dias: 21, estoque_seguranca: 2 }],
  ];
  for (const [codigo, descricao, tipo, op, unidade, p] of itens) {
    const origem = op === "comprado" ? "comprado" : "fabricado";
    const politica = op === "supermercado" ? "supermercado" : "sob_pedido";
    await sql`insert into itens (codigo, descricao, unidade, tipo, origem, politica, lead_time_dias, estoque_seguranca,
                estoque_min, estoque_max, lote_minimo, lote_multiplo)
              values (${codigo}, ${descricao}, ${unidade ?? "UN"}, ${tipo}, ${origem}, ${politica}, ${p?.lead_time_dias ?? 0},
                ${p?.estoque_seguranca ?? 0}, ${p?.estoque_min ?? 0}, ${p?.estoque_max ?? 0}, ${p?.lote_minimo ?? 0}, ${p?.lote_multiplo ?? 0})
              on conflict (codigo) do nothing`;
  }
  const id = new Map((await sql`select id, codigo from itens`).map((r) => [r.codigo as string, r.id as number]));
  const S = new Map((await sql`select id, codigo from setores`).map((r) => [r.codigo as string, r.id as number]));

  const bom: [string, string, number][] = [
    ["01.10.20.399", "01.10.40.004", 1],
    ["01.10.20.399", "01.10.10.008", 1],
    ["01.10.20.399", "01.10.10.015", 3],
    ["01.10.20.399", "01.10.10.009", 7],
    ["01.10.20.399", "01.10.10.022", 1],
    ["01.10.20.399", "01.10.10.023", 1],
    ["01.10.20.399", "01.10.01.004", 2],
    ["01.10.20.399", "01.10.01.009", 2],
    ["01.10.20.399", "01.10.60.003", 4],
    ["01.10.20.399", "CP-KITFIX", 1],
    ["01.10.20.399", "CP-TINTA", 4],
    ["01.10.20.412", "01.10.40.004", 1],
    ["01.10.20.412", "01.10.10.008", 1],
    ["01.10.20.412", "01.10.10.015", 5],
    ["01.10.20.412", "01.10.10.009", 11],
    ["01.10.20.412", "01.10.10.022", 1],
    ["01.10.20.412", "01.10.10.023", 1],
    ["01.10.20.412", "01.10.01.004", 2],
    ["01.10.20.412", "01.10.01.009", 2],
    ["01.10.20.412", "01.10.60.003", 6],
    ["01.10.20.412", "CP-KITFIX", 1],
    ["01.10.20.412", "CP-TINTA", 6],
    ["01.10.10.008", "01.10.40.300", 1],
    ["01.10.10.008", "01.10.03.230", 1],
    ["01.10.10.008", "01.10.03.231", 1],
    ["01.10.10.004", "01.10.01.005", 1],
    ["01.10.10.004", "01.10.40.005", 1],
    ["01.10.10.004", "01.10.60.001", 2],
    ["01.10.10.013", "01.10.60.010", 1],
    ["01.10.10.013", "01.10.70.002", 2],
    ["01.10.10.013", "01.10.70.004", 1],
    ["01.10.10.013", "CP-6206", 2],
    ["01.10.10.015", "01.10.01.270", 1],
    ["01.10.10.015", "01.10.01.271", 1],
    ["01.10.10.015", "01.10.10.004", 2],
    ["01.10.10.015", "01.10.01.006", 1],
    ["01.10.10.015", "01.10.01.007", 1],
    ["01.10.10.015", "01.10.01.002", 1],
    ["01.10.10.015", "05.10.03.032", 2],
    ["01.10.10.015", "01.10.10.013", 1],
    ["01.10.10.009", "01.10.01.008", 1],
    ["01.10.10.009", "01.10.60.011", 1],
    ["01.10.10.009", "01.10.70.008", 2],
    ["01.10.10.022", "01.10.40.006", 1],
    ["01.10.10.022", "01.10.60.002", 1],
    ["01.10.10.022", "01.10.70.003", 2],
    ["01.10.10.022", "CP-PNEU", 1],
    ["01.10.10.023", "01.10.40.006", 1],
    ["01.10.10.023", "01.10.60.002", 1],
    ["01.10.10.023", "01.10.70.003", 2],
    ["01.10.10.023", "CP-PNEU", 1],
    // matérias-primas das peças
    ["01.10.40.004", "MP-TB100", 4.8],
    ["01.10.40.004", "MP-CH14", 12],
    ["01.10.40.300", "MP-TB100", 2.4],
    ["01.10.03.230", "MP-CH14", 3.2],
    ["01.10.03.231", "MP-CH14", 3.2],
    ["01.10.01.002", "MP-CH14", 1.8],
    ["01.10.01.004", "MP-TB50", 0.585],
    ["01.10.01.005", "MP-TB50", 0.5],
    ["01.10.01.006", "MP-CH316", 1.4],
    ["01.10.01.007", "MP-CH316", 1.4],
    ["01.10.01.008", "MP-TB50", 0.2],
    ["01.10.01.009", "MP-TB50", 0.3],
    ["01.10.01.270", "MP-CH14", 2.6],
    ["01.10.01.271", "MP-CH14", 2.6],
    ["01.10.40.005", "MP-TB50", 0.45],
    ["01.10.40.006", "MP-BR32", 0.4],
    ["01.10.60.002", "MP-TB50", 0.35],
    ["01.10.70.004", "MP-BR32", 0.3],
    ["01.10.60.011", "MP-CH316", 1.9],
    ["01.10.70.002", "MP-BR55", 0.06],
    ["01.10.70.003", "MP-BR55", 0.055],
    ["01.10.70.008", "MP-BR32", 0.025],
    ["01.10.60.001", "MP-CH316", 0.25],
    ["01.10.60.003", "MP-TB50", 0.04],
    ["05.10.03.032", "MP-BR55", 0.055],
    ["01.10.60.010", "MP-BR55", 0.1],
  ];
  for (const [pai, filho, q] of bom) {
    const perda = filho.startsWith("MP-") ? 3 : 0;
    await sql`insert into estrutura (pai_id, filho_id, quantidade, perda_pct) values (${id.get(pai)!}, ${id.get(filho)!}, ${q}, ${perda})
              on conflict (pai_id, filho_id) do nothing`;
  }

  // roteiros: [item, [setor, descrição, setup, min/unidade]...]
  const P = (s: string, d: string, su: number, u: number) => [s, d, su, u] as const;
  const corteTubo = [P("CORTE", "Cortar tubo na serra fita", 15, 4), P("FURACAO", "Furar conforme desenho", 10, 5)];
  const corteChapa = [P("CORTE", "Cortar chapa", 15, 6), P("FURACAO", "Furar conforme desenho", 10, 4)];
  const usinar = [P("CORTE", "Cortar barra", 10, 2), P("USINAGEM", "Tornear", 30, 14)];
  const roteiros: [string, (readonly [string, string, number, number])[]][] = [
    ["01.10.20.399", [P("PINTURA", "Pintar máquina", 30, 240), P("MONTAGEM", "Montagem final e teste", 0, 480)]],
    ["01.10.20.412", [P("PINTURA", "Pintar máquina", 30, 330), P("MONTAGEM", "Montagem final e teste", 0, 660)]],
    ["01.10.10.008", [P("SOLDA", "Soldar conjunto porta-ferramentas", 10, 90)]],
    ["01.10.10.004", [P("SOLDA", "Soldar braço do pantógrafo", 10, 35)]],
    ["01.10.10.013", [P("MONTAGEM", "Montar mancal (prensar rolamentos)", 0, 25)]],
    ["01.10.10.015", [P("SOLDA", "Soldar unidade vibro", 10, 75)]],
    ["01.10.10.009", [P("SOLDA", "Soldar haste com enxada", 10, 18)]],
    ["01.10.10.022", [P("SOLDA", "Soldar conjunto roda", 10, 40)]],
    ["01.10.10.023", [P("SOLDA", "Soldar conjunto roda", 10, 40)]],
    ["01.10.40.004", [P("CORTE", "Cortar tubos do chassi", 20, 45), P("FURACAO", "Furar chassi", 15, 40), P("SOLDA", "Soldar chassi", 15, 150)]],
    ["01.10.40.300", corteTubo],
    ["01.10.03.230", corteChapa],
    ["01.10.03.231", corteChapa],
    ["01.10.01.002", corteChapa],
    ["01.10.01.004", corteTubo],
    ["01.10.01.005", corteTubo],
    ["01.10.01.006", corteChapa],
    ["01.10.01.007", corteChapa],
    ["01.10.01.008", corteTubo],
    ["01.10.01.009", corteTubo],
    ["01.10.01.270", corteChapa],
    ["01.10.01.271", corteChapa],
    ["01.10.40.005", corteTubo],
    ["01.10.40.006", usinar],
    ["01.10.60.002", corteTubo],
    ["01.10.70.004", usinar],
    ["01.10.60.011", [P("CORTE", "Cortar chapa da enxada", 15, 3), P("FURACAO", "Furar enxada", 10, 2)]],
    ["01.10.70.002", usinar],
    ["01.10.70.003", usinar],
    ["01.10.70.008", usinar],
    ["01.10.60.001", corteChapa],
    ["01.10.60.003", corteTubo],
    ["05.10.03.032", usinar],
    ["01.10.60.010", usinar],
  ];
  for (const [cod, ops] of roteiros) {
    for (let i = 0; i < ops.length; i++) {
      const [s, d, su, u] = ops[i];
      await sql`insert into roteiros (item_id, sequencia, setor_id, descricao, setup_min, tempo_unit_min)
                values (${id.get(cod)!}, ${(i + 1) * 10}, ${S.get(s)!}, ${d}, ${su}, ${u}) on conflict do nothing`;
    }
  }

  const saldos: [string, number][] = [
    ["MP-TB100", 30], ["MP-TB50", 40], ["MP-CH316", 180], ["MP-CH14", 260], ["MP-BR32", 18], ["MP-BR55", 12],
    ["CP-TINTA", 40], ["CP-KITFIX", 6], ["CP-6206", 30], ["CP-PNEU", 3],
    ["01.10.60.011", 55], ["01.10.70.002", 26], ["01.10.70.003", 24], ["01.10.70.008", 70], ["01.10.60.001", 40],
    ["01.10.60.003", 22], ["05.10.03.032", 30], ["01.10.60.010", 9],
  ];
  for (const [c, q] of saldos)
    await sql`insert into estoque_saldos (item_id, quantidade) values (${id.get(c)!}, ${q}) on conflict (item_id) do update set quantidade = excluded.quantidade`;
  await sql`insert into recebimentos_programados (item_id, quantidade, data_prevista, documento) values
            (${id.get("CP-PNEU")!}, 6, ${somarDias(hoje, 9)}, 'PC DEMO-88'), (${id.get("MP-BR55")!}, 12, ${somarDias(hoje, 4)}, 'PC DEMO-91')`;

  // NR12: torno em adequação por 3 dias na próxima semana
  const seg = segundaDaSemana(somarDias(hoje, 7));
  await sql`insert into indisponibilidades (setor_id, inicio, fim, recursos_indisponiveis, motivo)
            values (${S.get("USINAGEM")!}, ${seg}, ${somarDias(seg, 2)}, 1, 'Torno em adequação NR12 (proteções e intertravamento)')`;

  const pedidos: [string, string, number, string, number][] = [
    ["PV-DEMO-101", "Cliente Demo · Batata (MG)", 20, "01.10.20.399", 2],
    ["PV-DEMO-102", "Cliente Demo · Batata (PR)", 30, "01.10.20.412", 1],
    ["PV-DEMO-103", "Cliente Demo · Fumo (RS)", 12, "01.10.20.399", 1],
  ];
  for (const [numero, cliente, prazo, cod, q] of pedidos) {
    const [p] = await sql`insert into pedidos_venda (numero, cliente, data_emissao, data_entrega)
                          values (${numero}, ${cliente}, ${somarDias(hoje, -3)}, ${somarDias(hoje, prazo)}) returning id`;
    await sql`insert into pedido_itens (pedido_id, item_id, quantidade) values (${p.id}, ${id.get(cod)!}, ${q})`;
  }

  await historico(id, S);
  console.log("demo: Vibro 810 (2 variantes), 44 itens, roteiros, saldos, 3 pedidos, histórico de 2 semanas");
}

/** Simula duas semanas de fábrica usando os próprios serviços (dados consistentes). */
async function historico(id: Map<string, number>, S: Map<string, number>) {
  const { criarOP, liberarOP, criarOPDoPedido } = await import("../src/server/ops");
  const { executarAcao } = await import("../src/server/posto");
  const { aprovarPrograma, reprogramar } = await import("../src/server/programacao");
  const hoje = hojeNoFuso();
  const admin = (await sql`select id from usuarios where login = 'admin'`)[0].id as number;
  const operador = new Map((await sql`select id, setor_id from usuarios where perfil = 'operador'`).map((r) => [r.setor_id as number, r.id as number]));
  const motivos = new Map((await sql`select id, codigo from motivos_parada`).map((r) => [r.codigo as string, r.id as number]));
  let seq = 0;
  const chave = () => `seed-${Date.now().toString(36)}-${seq++}`;

  // avança o relógio respeitando o turno (07:00 às 16:48 em São Paulo = 10:00 às 19:48 UTC) e fins de semana
  const avancar = (t: Date, minutos: number) => {
    let d = new Date(t);
    let resta = minutos;
    const ajustar = () => {
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      if (m >= 19 * 60 + 48 || [0, 6].includes(d.getUTCDay())) {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(10, 0, 0, 0);
        while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
      } else if (m < 600) d.setUTCHours(10, 0, 0, 0);
    };
    ajustar();
    while (resta > 0) {
      const m = d.getUTCHours() * 60 + d.getUTCMinutes();
      const disp = 19 * 60 + 48 - m;
      const passo = Math.min(disp, resta);
      d = new Date(d.getTime() + passo * 60_000);
      resta -= passo;
      if (resta > 0) ajustar();
    }
    return d;
  };

  const executarOP = async (opId: number, inicioDia: string, fatorAtraso: number, paradasExtras: [string, number][]) => {
    const inicio = new Date(`${inicioDia}T10:00:00Z`);
    const tarefas = await sql`select id, setor_id, quantidade, tempo_previsto_min, nivel from tarefas where op_id = ${opId} order by nivel desc, sequencia, id`;
    const recursos = new Map((await sql`select id, recursos from setores`).map((r) => [r.id as number, r.recursos as number]));
    const raias = new Map<number, Date[]>();
    const fim = new Map<number, Date>();
    let k = 0;
    while (fim.size < tarefas.length) {
      for (const t of tarefas) {
        if (fim.has(t.id as number)) continue;
        const deps = (await sql`select depende_de_id from tarefa_dependencias where tarefa_id = ${t.id}`).map((d) => d.depende_de_id as number);
        if (deps.some((d) => !fim.has(d))) continue;
        const setor = t.setor_id as number;
        const lanes = raias.get(setor) ?? Array.from({ length: recursos.get(setor) ?? 1 }, () => inicio);
        raias.set(setor, lanes);
        const li = lanes.indexOf(lanes.reduce((a, b) => (a < b ? a : b)));
        const pronto = deps.reduce((a, d) => (fim.get(d)! > a ? fim.get(d)! : a), inicio);
        let relogio = avancar(lanes[li] > pronto ? lanes[li] : pronto, 0);
        const u = operador.get(setor)!;
        const dur = Number(t.tempo_previsto_min) * fatorAtraso;
        await executarAcao(chave(), { tipo: "iniciar", tarefa_id: t.id as number }, u, relogio);
        relogio = avancar(relogio, dur / 2);
        if (paradasExtras.length && k % 4 === 0) {
          const [mot, min] = paradasExtras[(k / 4) % paradasExtras.length];
          await executarAcao(chave(), { tipo: "pausar", tarefa_id: t.id as number, motivo_id: motivos.get(mot)!, qtd_boa: 0, qtd_refugo: 0 }, u, relogio);
          relogio = avancar(relogio, min);
          await executarAcao(chave(), { tipo: "retomar", tarefa_id: t.id as number }, u, relogio);
        }
        relogio = avancar(relogio, dur / 2);
        const refugo = k % 9 === 4 ? 1 : 0;
        await executarAcao(
          chave(),
          { tipo: "concluir", tarefa_id: t.id as number, qtd_boa: Number(t.quantidade), qtd_refugo: refugo, motivo_refugo_id: refugo ? 1 : null },
          u,
          relogio,
        );
        lanes[li] = relogio;
        fim.set(t.id as number, relogio);
        k++;
      }
    }
    // paradas de refeição (planejadas) em cada dia trabalhado, para o OEE
    const [{ ultimo }] = await sql`select max(concluida_em) as ultimo from tarefas where op_id = ${opId}`;
    for (let d = new Date(inicio); d <= (ultimo as Date); d.setUTCDate(d.getUTCDate() + 1)) {
      if ([0, 6].includes(d.getUTCDay())) continue;
      const ref = new Date(d);
      ref.setUTCHours(15, 0, 0, 0);
      for (const [setor] of recursos)
        await sql`insert into paradas (setor_id, motivo_id, usuario_id, inicio, fim)
                  values (${setor}, ${motivos.get("100")!}, ${admin}, ${ref}, ${new Date(ref.getTime() + 60 * 60_000)})`;
    }
    return ultimo as Date;
  };

  // OP 1: vibro entregue no prazo; OP 2: entregue com atraso (paradas por aprovação e falta de material)
  await sql`update estoque_saldos set quantidade = quantidade + 100`;
  const op1 = await criarOP({ item_id: id.get("01.10.20.399")!, quantidade: 1, data_necessidade: hoje, origem: "pedido", observacao: "Histórico demo" }, admin);
  await liberarOP(op1.id, admin);
  await sql`update ordens_producao set liberada_em = ${somarDias(hoje, -15)}::date + interval '10 hours' where id = ${op1.id}`;
  const fim1 = await executarOP(op1.id, somarDias(hoje, -15), 0.9, [["200", 25], ["300", 40]]);

  const op2 = await criarOP({ item_id: id.get("01.10.20.399")!, quantidade: 1, data_necessidade: hoje, origem: "pedido", observacao: "Histórico demo" }, admin);
  await liberarOP(op2.id, admin);
  await sql`update ordens_producao set liberada_em = ${somarDias(hoje, -10)}::date + interval '10 hours' where id = ${op2.id}`;
  const fim2 = await executarOP(op2.id, somarDias(hoje, -10), 1.3, [["600", 240], ["400", 150], ["200", 30], ["401", 90], ["302", 120]]);
  await sql`update estoque_saldos set quantidade = greatest(quantidade - 100, 0)`;
  // promessas: OP1 com folga de 2 dias, OP2 prometida 2 dias antes de terminar
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  await sql`update ordens_producao set data_necessidade = ${somarDias(dia(fim1), 2)} where id = ${op1.id}`;
  await sql`update ordens_producao set data_necessidade = ${somarDias(dia(fim2), -2)} where id = ${op2.id}`;
  // conclusões do histórico não vão para o Omie
  await sql`delete from outbox`;

  // carteira atual: OP do pedido 101 liberada e em andamento; 103 firmada; 102 firmada
  const peds = await sql`select pi.id, p.numero from pedido_itens pi join pedidos_venda p on p.id = pi.pedido_id order by p.numero`;
  const opA = await criarOPDoPedido(peds[0].id as number, admin);
  await liberarOP(opA.id, admin, null).catch(async () => liberarOP(opA.id, admin, "Pneus chegam no PC DEMO-88 antes da montagem"));
  await criarOPDoPedido(peds[2].id as number, admin);
  await criarOPDoPedido(peds[1].id as number, admin);
  await criarOP({ item_id: id.get("01.10.60.011")!, quantidade: 40, data_necessidade: somarDias(hoje, 6), origem: "supermercado", observacao: "Reposição supermercado" }, admin);

  // programa da semana passada aprovado (para a aderência) = tarefas da OP2 previstas
  const semAnt = somarDias(segundaDaSemana(hoje), -7);
  const [prog] = await sql`insert into programas_semanais (semana, status, aprovado_por, aprovado_em) values (${semAnt}, 'aprovado',
                           (select id from usuarios where login = 'fernando'), ${semAnt}::date + interval '8 hours') returning id`;
  await sql`insert into programa_itens (programa_id, tarefa_id) select ${prog.id}, id from tarefas where op_id in (${op1.id}, ${op2.id})`;

  await reprogramar();
  // inicia algumas tarefas da OP liberada para o Kanban ter movimento
  const prontas = await sql`
    select t.id, t.setor_id from tarefas t where t.op_id = ${opA.id}
      and not exists (select 1 from tarefa_dependencias d where d.tarefa_id = t.id) order by t.id limit 3`;
  for (const t of prontas) await executarAcao(chave(), { tipo: "iniciar", tarefa_id: t.id as number }, operador.get(t.setor_id as number)!, new Date());
  void aprovarPrograma;
  void S;
}

(async () => {
  await base();
  if (DEMO) await demo();
  await sql.end();
})().catch(async (e) => {
  console.error(e);
  await sql.end();
  process.exit(1);
});
