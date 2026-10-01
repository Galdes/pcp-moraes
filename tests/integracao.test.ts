// Testes de integração contra um PostgreSQL real (banco pcp_test).
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";

const URL_TESTE = process.env.DATABASE_URL_TEST ?? "postgres://pcp:pcp@localhost:5432/pcp_test";
process.env.DATABASE_URL = URL_TESTE;
process.env.OMIE_MODO = "ativo";
process.env.OMIE_APP_KEY = "k";
process.env.OMIE_APP_SECRET = "s";

import { migrar } from "../scripts/migrate";
import { sql } from "@/lib/db";
import { criarOP, kitDaOP, liberarOP } from "@/server/ops";
import { executarAcao, filaDoSetor } from "@/server/posto";
import { executarMRP, converterSugestaoEmOP, enviarRequisicaoCompra } from "@/server/mrp";
import { reprogramar, cargaPorSetor, aprovarPrograma } from "@/server/programacao";
import { kpis, paretoParadas, oeePorSetor } from "@/server/indicadores";
import { checagens } from "@/server/qualidade";
import { ClienteOmie, ErroOmie, type EstadoIntegracao } from "@/integrations/omie/cliente";
import { CONTRATOS } from "@/integrations/omie/contratos";
import {
  executarSincronizacao,
  processarOutbox,
  sincronizarClientes,
  sincronizarEstoque,
  sincronizarEstrutura,
  sincronizarPedidos,
  sincronizarProdutos,
  SincronizacaoParcial,
} from "@/integrations/omie/sync";
import { formatarOmie, hojeNoFuso, somarDias } from "@/domain/datas";

let admin: number;
let item: (c: string) => Promise<number>;

beforeAll(async () => {
  await migrar(URL_TESTE, true);
  execFileSync("npx", ["tsx", "scripts/seed.ts", "--demo"], { env: { ...process.env, DATABASE_URL: URL_TESTE }, stdio: "pipe" });
  admin = (await sql`select id from usuarios where login = 'admin'`)[0].id as number;
  item = async (c) => (await sql`select id from itens where codigo = ${c}`)[0].id as number;
}, 120_000);

describe("ciclo da OP", () => {
  it("cria OP, gera tarefas e kit; recusa liberar com falta sem responsável", async () => {
    await sql`update estoque_saldos set quantidade = 0 where item_id = ${await item("CP-PNEU")}`;
    const op = await criarOP({ item_id: await item("01.10.20.399"), quantidade: 1, data_necessidade: somarDias(hojeNoFuso(), 20), origem: "manual" }, admin);
    const [{ n }] = await sql`select count(*)::int as n from tarefas where op_id = ${op.id}`;
    expect(n).toBe(44);
    const kit = await kitDaOP(op.id);
    expect(kit.completo).toBe(false);
    expect(kit.linhas[0].codigo).toBe("CP-PNEU");
    await expect(liberarOP(op.id, admin)).rejects.toThrow(/Kit incompleto/);
    await liberarOP(op.id, admin, "Compras garante pneus até a montagem");
    const [o] = await sql`select status, falta_assumida_obs from ordens_producao where id = ${op.id}`;
    expect(o.status).toBe("liberada");
    const [ob] = await sql`select tipo, status from outbox where referencia = (select numero::text from ordens_producao where id = ${op.id})`;
    expect(ob).toMatchObject({ tipo: "incluir_op", status: "pendente" });
  });

  it("posto: bloqueia etapa sem a anterior, é idempotente e fecha a OP no fim", async () => {
    const op = await criarOP({ item_id: await item("01.10.60.011"), quantidade: 10, data_necessidade: somarDias(hojeNoFuso(), 5), origem: "supermercado" }, admin);
    await sql`update estoque_saldos set quantidade = 500 where item_id = ${await item("MP-CH316")}`;
    await liberarOP(op.id, admin);
    const [corte, furo] = await sql`select id from tarefas where op_id = ${op.id} order by sequencia`;
    const u = (await sql`select id from usuarios where login = '1001'`)[0].id as number;

    await expect(executarAcao("teste-furo-antes-00", { tipo: "iniciar", tarefa_id: furo.id as number }, u)).rejects.toThrow(/anterior/);
    await executarAcao("teste-inicia-corte-1", { tipo: "iniciar", tarefa_id: corte.id as number }, u);
    const repetida = await executarAcao("teste-inicia-corte-1", { tipo: "iniciar", tarefa_id: corte.id as number }, u);
    expect(repetida.repetida).toBe(true);
    const [{ n }] = await sql`select count(*)::int as n from apontamentos where tarefa_id = ${corte.id}`;
    expect(n).toBe(1);

    const parada = (await sql`select id from motivos_parada where codigo = '300'`)[0].id as number;
    await executarAcao("teste-pausa-corte-01", { tipo: "pausar", tarefa_id: corte.id as number, motivo_id: parada, qtd_boa: 4, qtd_refugo: 0 }, u);
    await executarAcao("teste-retoma-corte-1", { tipo: "retomar", tarefa_id: corte.id as number }, u);
    await expect(
      executarAcao("teste-conclui-sem-mot", { tipo: "concluir", tarefa_id: corte.id as number, qtd_boa: 6, qtd_refugo: 1 }, u),
    ).rejects.toThrow(/motivo do refugo/);
    await executarAcao("teste-conclui-corte-1", { tipo: "concluir", tarefa_id: corte.id as number, qtd_boa: 6, qtd_refugo: 1, motivo_refugo_id: 1 }, u);
    const [tc] = await sql`select status, qtd_boa, qtd_refugo from tarefas where id = ${corte.id}`;
    expect(tc).toMatchObject({ status: "concluida", qtd_boa: 10, qtd_refugo: 1 });

    const u2 = (await sql`select id from usuarios where login = '1002'`)[0].id as number;
    await executarAcao("teste-inicia-furo-01", { tipo: "iniciar", tarefa_id: furo.id as number }, u2);
    const r = await executarAcao("teste-conclui-furo-1", { tipo: "concluir", tarefa_id: furo.id as number, qtd_boa: 10, qtd_refugo: 0 }, u2);
    expect(r.mensagem).toMatch(/finalizada/);
    const [o] = await sql`select status, qtd_boa from ordens_producao where id = ${op.id}`;
    expect(o).toMatchObject({ status: "concluida", qtd_boa: 10 });
    const [pa] = await sql`select fim from paradas where tarefa_id = ${corte.id}`;
    expect(pa.fim).not.toBeNull();
  });

  it("fila do setor mostra prontas e aguardando", async () => {
    const corte = (await sql`select id from setores where codigo = 'CORTE'`)[0].id as number;
    const fila = await filaDoSetor(corte);
    expect(fila.length).toBeGreaterThan(0);
    expect(fila.some((f) => f.pronta)).toBe(true);
  });
});

describe("concorrência e bordas", () => {
  it("dois cliques em gerar OP do pedido criam uma OP só", async () => {
    const { criarOPDoPedido } = await import("@/server/ops");
    const [pi] = await sql`insert into pedidos_venda (numero, cliente, data_entrega) values ('PV-CONC', 'Teste', ${somarDias(hojeNoFuso(), 40)}) returning id`;
    const [linha] = await sql`insert into pedido_itens (pedido_id, item_id, quantidade) values (${pi.id}, ${await item("01.10.20.399")}, 1) returning id`;
    const r = await Promise.allSettled([criarOPDoPedido(linha.id as number, admin), criarOPDoPedido(linha.id as number, admin)]);
    expect(r.filter((x) => x.status === "fulfilled").length).toBe(1);
    const [{ n }] = await sql`select count(*)::int as n from ordens_producao where pedido_item_id = ${linha.id}`;
    expect(n).toBe(1);
  });

  it("horário do tablet atrasado não quebra o apontamento (fim nunca antes do início)", async () => {
    const op = await criarOP({ item_id: await item("01.10.70.008"), quantidade: 5, data_necessidade: somarDias(hojeNoFuso(), 5), origem: "supermercado" }, admin);
    await sql`update estoque_saldos set quantidade = 999 where item_id = ${await item("MP-BR32")}`;
    await liberarOP(op.id, admin);
    const [t1] = await sql`select id from tarefas where op_id = ${op.id} order by sequencia limit 1`;
    const u = (await sql`select id from usuarios where login = '1001'`)[0].id as number;
    const agora = new Date();
    await executarAcao("borda-inicia-000001", { tipo: "iniciar", tarefa_id: t1.id as number }, u, agora);
    await executarAcao("borda-conclui-00001", { tipo: "concluir", tarefa_id: t1.id as number, qtd_boa: 5, qtd_refugo: 0 }, u, new Date(agora.getTime() - 3 * 60_000));
    const [a] = await sql`select inicio, fim from apontamentos where tarefa_id = ${t1.id}`;
    expect((a.fim as Date).getTime()).toBeGreaterThanOrEqual((a.inicio as Date).getTime());
  });
});

describe("planejamento", () => {
  it("reprograma com capacidade finita e calcula carga", async () => {
    const r = await reprogramar();
    expect(r.tarefas).toBeGreaterThan(50);
    const [semData] = await sql`select count(*)::int as n from tarefas t join ordens_producao o on o.id = t.op_id
                                where o.status in ('firmada','liberada','em_processo') and t.status <> 'concluida' and t.fim_previsto is null`;
    expect(semData.n).toBe(0);
    const { carga } = await cargaPorSetor(6);
    expect(carga.reduce((a, c) => a + c.carga_min, 0)).toBeGreaterThan(0);
  });

  it("MRP gera sugestões e converte em OP e requisição", async () => {
    const ex = await executarMRP(admin);
    expect(ex.sugestoes).toBeGreaterThan(0);
    const compra = await sql`select id from sugestoes where execucao_id = ${ex.id} and tipo = 'compra' and status = 'aberta'`;
    expect(compra.length).toBeGreaterThan(0);
    const req = await enviarRequisicaoCompra(compra.map((c) => c.id as number), admin);
    expect(req.itens).toBe(compra.length);
    const prod = await sql`select id from sugestoes where execucao_id = ${ex.id} and tipo = 'producao' and status = 'aberta' limit 1`;
    if (prod.length) {
      const op = await converterSugestaoEmOP(prod[0].id as number, admin);
      expect(op.numero).toBeGreaterThan(1000);
    }
  });

  it("aprova programa semanal", async () => {
    const r = await aprovarPrograma(hojeNoFuso(), admin, "teste");
    expect(r.tarefas).toBeGreaterThan(0);
  });

  it("indicadores e qualidade de dados", async () => {
    const k = await kpis();
    expect(k.concluidas).toBeGreaterThanOrEqual(2);
    expect(k.otd).toBe(0.5); // uma no prazo, outra atrasada (histórico demo)
    expect(k.aderencia).not.toBeNull();
    const p = await paretoParadas();
    expect(p[0].chave).toBe("Aguardando aprovação da diretoria");
    const oee = await oeePorSetor(somarDias(hojeNoFuso(), -20), hojeNoFuso(), true);
    expect(oee[0].oee).toBeGreaterThan(0);
    const q = await checagens();
    expect(q.ciclos).toEqual([]);
    expect(q.semOmie.length).toBeGreaterThan(0);
  });
});

// ---------- Omie ----------
const memoria = () => {
  let e: EstadoIntegracao = { bloqueado_ate: null, erros_consecutivos: 0, dia: null, chamadas_dia: 0 };
  return { ler: async () => e, atualizar: async (f: (x: EstadoIntegracao) => EstadoIntegracao) => void (e = f(e)), get: () => e };
};
const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });
/** Volta produtos e pedidos para a leitura completa (apaga o modo incremental salvo). */
const limparModo = () => sql`delete from integracao_estado where entidade like 'cursor:modo:%'`;
const INCREMENTAL = /^alterados desde \d{2}\/\d{2}\/\d{4}: /;

describe("cliente Omie", () => {
  it("respeita o limite por minuto", async () => {
    let t = 0;
    const esperas: number[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      reqPorMinuto: 2,
      estado: memoria(),
      agora: () => t,
      dormir: async (ms) => {
        esperas.push(ms);
        t += ms;
      },
      fetchFn: async () => resposta({ ok: 1 }),
    });
    for (let i = 0; i < 3; i++) await c.chamar(CONTRATOS.listarProdutos, {});
    expect(esperas.length).toBe(1);
    expect(esperas[0]).toBeGreaterThanOrEqual(60_000);
  });

  it("abre o disjuntor após 3 erros e não conta consumo redundante", async () => {
    const est = memoria();
    let chamadas = 0;
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: est,
      fetchFn: async (_u, init) => {
        chamadas++;
        const body = JSON.parse(String(init!.body));
        if (body.param[0].redundante) return resposta({ faultstring: "Consumo redundante detectado", faultcode: "SOAP-ENV:Client-6" }, 500);
        return resposta({ faultstring: "ERROR: Tag inválida", faultcode: "SOAP-ENV:Client-8" }, 500);
      },
    });
    await expect(c.chamar(CONTRATOS.listarProdutos, { redundante: 1 })).rejects.toMatchObject({ tipo: "redundante" });
    expect(est.get().erros_consecutivos).toBe(0);
    for (let i = 0; i < 3; i++) await expect(c.chamar(CONTRATOS.listarProdutos, {})).rejects.toBeInstanceOf(ErroOmie);
    expect(est.get().bloqueado_ate).not.toBeNull();
    const antes = chamadas;
    await expect(c.chamar(CONTRATOS.listarProdutos, {})).rejects.toMatchObject({ tipo: "circuito" });
    expect(chamadas).toBe(antes); // nem chegou a chamar
  });

  it("sincroniza produtos, estoque e pedidos a partir de respostas do Omie", async () => {
    const vibro = await item("01.10.20.399");
    const respostas: Record<string, unknown> = {
      ListarProdutos: {
        pagina: 1,
        total_de_paginas: 1,
        produto_servico_cadastro: [
          { codigo_produto: 900001, codigo: "01.10.20.399", descricao: "CA VIBRO 810 03U-0,90M-07ENX-BR02,40M", unidade: "UN" },
          { codigo_produto: 900002, codigo: "CP-PNEU", descricao: "RODA COM PNEU 6.50-16", unidade: "UN" },
          { codigo_produto: 900003, codigo: "01.10.10.099", descricao: "CJ NOVO DO OMIE", unidade: "UN" },
        ],
      },
      ListarPosEstoque: { nPagina: 1, nTotPaginas: 1, produtos: [{ nCodProd: 900002, cCodigo: "CP-PNEU", nSaldo: 7 }] },
      ListarPedidos: {
        pagina: 1,
        total_de_paginas: 1,
        pedido_venda_produto: [
          {
            cabecalho: { codigo_pedido: 777, numero_pedido: "4512", data_previsao: "30/11/2026", etapa: "20", codigo_cliente: 55 },
            det: [{ produto: { codigo_produto: 900001, quantidade: 3 } }],
          },
        ],
      },
    };
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => resposta(respostas[JSON.parse(String(init!.body)).call as string]),
    });
    await limparModo();
    expect(await sincronizarProdutos(c)).toBe("1 novos, 2 atualizados");
    const [novo] = await sql`select tipo, origem, revisar from itens where codigo = '01.10.10.099'`;
    expect(novo).toMatchObject({ tipo: "conjunto", origem: "fabricado", revisar: true });
    const [v] = await sql`select tipo, omie_id from itens where id = ${vibro}`;
    expect(v).toMatchObject({ tipo: "produto", omie_id: 900001 }); // classificação do PCP preservada
    await sql`insert into estoque_saldos (item_id, quantidade, fonte) values (${await item("MP-TB50")}, 99, 'omie')
              on conflict (item_id) do update set fonte = 'omie', quantidade = 99`;
    await sincronizarEstoque(c);
    const [pneu] = await sql`select quantidade from estoque_saldos where item_id = ${await item("CP-PNEU")}`;
    expect(pneu.quantidade).toBe(7);
    const [tb] = await sql`select quantidade from estoque_saldos where item_id = ${await item("MP-TB50")}`;
    expect(tb.quantidade).toBe(0); // não veio na posição do Omie: zerado
    await sincronizarPedidos(c);
    const [ped] = await sql`select p.numero, p.data_entrega, pi.quantidade from pedidos_venda p join pedido_itens pi on pi.pedido_id = p.id where p.omie_id = 777`;
    expect(ped).toMatchObject({ numero: "4512", data_entrega: "2026-11-30", quantidade: 3 });
  });

  it("produtos em fatias: para no prazo, grava onde parou e continua na próxima execução", async () => {
    const paginasPedidas: number[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        const pagina = JSON.parse(String(init!.body)).param[0].pagina as number;
        paginasPedidas.push(pagina);
        return resposta({
          pagina,
          total_de_paginas: 3,
          produto_servico_cadastro: [{ codigo_produto: 910000 + pagina, codigo: `FATIA-${pagina}`, descricao: `PECA FATIA ${pagina}`, unidade: "UN" }],
        });
      },
    });
    const vencido = { ate: Date.now() - 1 }; // prazo já esgotado: faz uma página e para
    await limparModo();
    await expect(sincronizarProdutos(c, vencido)).rejects.toBeInstanceOf(SincronizacaoParcial);
    await expect(sincronizarProdutos(c, vencido)).rejects.toBeInstanceOf(SincronizacaoParcial);
    expect(await sincronizarProdutos(c)).toBe("3 novos, 0 atualizados"); // total acumulado entre execuções
    expect(paginasPedidas).toEqual([1, 2, 3]); // nunca relê página
    const [{ n }] = await sql`select count(*)::int as n from itens where codigo like 'FATIA-%'`;
    expect(n).toBe(3);
    const [cur] = await sql`select mensagem from integracao_estado where entidade = 'cursor:produtos'`;
    expect(cur.mensagem).toBeNull();
  });

  it("pedido do Omie com número já usado não derruba a sincronização", async () => {
    const vibro = await item("01.10.20.399");
    await sql`insert into pedidos_venda (numero, cliente, data_entrega) values ('9001', 'Digitado no PCP', '2026-12-01')`;
    await sql`insert into pedidos_venda (numero, cliente, data_entrega, omie_id) values ('9002', 'Outro do Omie', '2026-12-01', 555001)`;
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async () =>
        resposta({
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            { cabecalho: { codigo_pedido: 555010, numero_pedido: "9001", data_previsao: "10/12/2026", etapa: "20" }, det: [{ produto: { codigo_produto: 900001, quantidade: 1 } }] },
            { cabecalho: { codigo_pedido: 555020, numero_pedido: "9002", data_previsao: "11/12/2026", etapa: "20" }, det: [{ produto: { codigo_produto: 900001, quantidade: 2 } }] },
            { cabecalho: { codigo_pedido: 555030, numero_pedido: "9003", data_previsao: "12/12/2026", etapa: "20" }, det: [{ produto: { codigo_produto: 900001, quantidade: 1 } }] },
            { cabecalho: { codigo_pedido: 555031, numero_pedido: "9003", data_previsao: "13/12/2026", etapa: "20" }, det: [{ produto: { codigo_produto: 900001, quantidade: 1 } }] },
          ],
        }),
    });
    await limparModo();
    expect(await sincronizarPedidos(c)).toBe("4 pedidos");
    const [manual] = await sql`select omie_id, data_entrega from pedidos_venda where numero = '9001'`;
    expect(manual).toMatchObject({ omie_id: 555010, data_entrega: "2026-12-10" }); // o digitado passa a ser o do Omie
    const [repetido] = await sql`select numero from pedidos_venda where omie_id = 555020`;
    expect(repetido.numero).toBe("9002 (Omie 555020)");
    const mesmaPagina = await sql`select numero from pedidos_venda where omie_id in (555030, 555031) order by omie_id`;
    expect(mesmaPagina.map((r) => r.numero)).toEqual(["9003", "9003 (Omie 555031)"]); // repetido dentro da mesma página
    expect(await sincronizarPedidos(c)).toMatch(/4 pedidos$/); // rodar de novo (agora incremental) não duplica nem quebra
    const [{ total }] = await sql`select count(*)::int as total from pedidos_venda where omie_id between 555000 and 555999`;
    expect(total).toBe(5);
    const [{ n }] = await sql`select count(*)::int as n from pedido_itens where item_id = ${vibro} and pedido_id in (select id from pedidos_venda where omie_id in (555010, 555020))`;
    expect(n).toBe(2);
  });

  it("uma sincronização por vez, com trava que expira sozinha", async () => {
    await sql`insert into integracao_estado (entidade, bloqueado_ate) values ('trava:omie', now() + interval '1 minute')
              on conflict (entidade) do update set bloqueado_ate = excluded.bloqueado_ate`;
    const c = new ClienteOmie({ appKey: "k", appSecret: "s", estado: memoria(), fetchFn: async () => resposta({}) });
    expect(await executarSincronizacao({ forcar: [], cliente: c })).toEqual([{ entidade: "omie", ok: false, mensagem: "Já existe uma sincronização em andamento" }]);
    await sql`update integracao_estado set bloqueado_ate = now() - interval '1 second' where entidade = 'trava:omie'`; // função encerrada no meio
    expect(await executarSincronizacao({ forcar: [], cliente: c })).toEqual([]); // pegou a trava vencida
    const [t] = await sql`select bloqueado_ate from integracao_estado where entidade = 'trava:omie'`;
    expect(t.bloqueado_ate).toBeNull();
  });

  it("em escrita, 'não encontrado' do Omie é erro (não sucesso silencioso)", async () => {
    const c = new ClienteOmie({ appKey: "k", appSecret: "s", estado: memoria(), fetchFn: async () => resposta({ faultstring: "ERROR: Produto não encontrado" }, 500) });
    await expect(c.chamar(CONTRATOS.incluirOP, {})).rejects.toMatchObject({ tipo: "api" });
    await expect(c.chamar(CONTRATOS.listarProdutos, {}, { listagem: true })).resolves.toEqual({});
  });

  it("outbox envia a OP com o contrato verificado e segura os não validados", async () => {
    const enviados: { call: string; param: Record<string, unknown> }[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        const b = JSON.parse(String(init!.body));
        enviados.push({ call: b.call, param: b.param[0] });
        return resposta({ nCodOP: 123456, cCodStatus: "0", cDescStatus: "OP cadastrada com sucesso!" });
      },
    });
    const r = await processarOutbox(c, 50);
    expect(enviados.some((e) => e.call === "IncluirOrdemProducao")).toBe(true);
    const inc = enviados.find((e) => e.call === "IncluirOrdemProducao")!;
    expect(inc.param).toMatchObject({ identificacao: { nCodProduto: 900001, nQtde: expect.any(Number) } });
    expect(String((inc.param.identificacao as Record<string, unknown>).dDtPrevisao)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(enviados.some((e) => e.call === "IncluirReq")).toBe(false); // não validado
    const [pend] = await sql`select ultimo_erro from outbox where tipo = 'requisicao_compra'`;
    expect(pend.ultimo_erro).toMatch(/Aguardando validação|sem vínculo/);
    expect(r).toMatch(/enviados/);
    const [op] = await sql`select omie_id from ordens_producao where omie_id = 123456`;
    expect(op).toBeTruthy();
  });
});

describe("leitura incremental de produtos", () => {
  const hoje = hojeNoFuso();
  const desde = formatarOmie(somarDias(hoje, -2));
  const produtos = { pagina: 1, total_de_paginas: 1, produto_servico_cadastro: [{ codigo_produto: 930001, codigo: "INC-1", descricao: "PECA INCREMENTAL", unidade: "UN" }] };

  it("a primeira leitura é completa; a segunda envia o filtro dos últimos 2 dias", async () => {
    const params: Record<string, unknown>[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        params.push(JSON.parse(String(init!.body)).param[0]);
        return resposta(produtos);
      },
    });
    await limparModo();
    expect(await sincronizarProdutos(c)).not.toMatch(INCREMENTAL);
    expect(params[0]).not.toHaveProperty("filtrar_por_data_de");
    const segunda = await sincronizarProdutos(c);
    expect(segunda).toBe(`alterados desde ${desde}: 0 novos, 1 atualizados`);
    expect(params[1]).toMatchObject({ filtrar_por_data_de: desde, filtrar_por_data_ate: formatarOmie(hoje) });
    expect(String(params[1].filtrar_por_data_de)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("depois de 24 h volta a fazer a leitura completa; OMIE_INCREMENTAL=0 desliga", async () => {
    const params: Record<string, unknown>[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        params.push(JSON.parse(String(init!.body)).param[0]);
        return resposta(produtos);
      },
    });
    await sql`update integracao_estado set mensagem = ${JSON.stringify({ ultimaCompleta: new Date(Date.now() - 25 * 3600_000).toISOString() })}
              where entidade = 'cursor:modo:produtos'`;
    expect(await sincronizarProdutos(c)).not.toMatch(INCREMENTAL);
    expect(params[0]).not.toHaveProperty("filtrar_por_data_de");
    process.env.OMIE_INCREMENTAL = "0";
    try {
      expect(await sincronizarProdutos(c)).not.toMatch(INCREMENTAL);
      expect(params[1]).not.toHaveProperty("filtrar_por_data_de");
    } finally {
      delete process.env.OMIE_INCREMENTAL;
    }
    expect(await sincronizarProdutos(c)).toMatch(INCREMENTAL);
  });

  it("se o Omie recusar o filtro, cai para a leitura completa na mesma execução e fica desligado", async () => {
    const params: Record<string, unknown>[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        const p = JSON.parse(String(init!.body)).param[0];
        params.push(p);
        if (p.filtrar_por_data_de) return resposta({ faultstring: "ERROR: Tag [FILTRAR_POR_DATA_DE] não faz parte da estrutura do tipo [prdListarRequest]!", faultcode: "SOAP-ENV:Client-8" }, 500);
        return resposta(produtos);
      },
    });
    await limparModo();
    await sincronizarProdutos(c); // completa
    expect(await sincronizarProdutos(c)).toBe("0 novos, 1 atualizados"); // tentou incremental, foi recusado, refez completa
    expect(params.map((p) => !!p.filtrar_por_data_de)).toEqual([false, true, false]);
    const [modo] = await sql`select mensagem from integracao_estado where entidade = 'cursor:modo:produtos'`;
    expect(JSON.parse(modo.mensagem as string)).toMatchObject({ desligado: true });
    const [aviso] = await sql`select status, mensagem from integracao_log where entidade = 'produtos' order by id desc limit 1`;
    expect(aviso).toMatchObject({ status: "erro" });
    expect(aviso.mensagem).toMatch(/incremental desligada/);
    expect(await sincronizarProdutos(c)).not.toMatch(INCREMENTAL); // continua desligado
    expect(params).toHaveLength(4);
    expect(params[3]).not.toHaveProperty("filtrar_por_data_de");
    await limparModo();
  });
});

describe("nomes dos clientes", () => {
  it("o nome substitui o código nos pedidos antigos e nos novos", async () => {
    const [antes] = await sql`select cliente from pedidos_venda where omie_id = 777`;
    expect(antes.cliente).toBe("Cliente Omie 55");
    const chamadas: { call: string; param: Record<string, unknown> }[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        const b = JSON.parse(String(init!.body));
        chamadas.push({ call: b.call, param: b.param[0] });
        if (b.call === "ListarClientesResumido") {
          return resposta({
            pagina: b.param[0].pagina,
            total_de_paginas: 2,
            clientes_cadastro_resumido:
              b.param[0].pagina === 1
                ? [{ codigo_cliente: 55, nome_fantasia: "Fazenda Boa Vista", razao_social: "Boa Vista Agro Ltda" }]
                : [{ codigo_cliente: 56, nome_fantasia: "", razao_social: "Usina Santa Rita S/A" }],
          });
        }
        return resposta({
          pagina: 1,
          total_de_paginas: 1,
          pedido_venda_produto: [
            { cabecalho: { codigo_pedido: 778, numero_pedido: "4513", data_previsao: "15/12/2026", etapa: "20", codigo_cliente: 56 }, det: [{ produto: { codigo_produto: 900001, quantidade: 1 } }] },
          ],
        });
      },
    });
    await expect(sincronizarClientes(c, { ate: Date.now() - 1 })).rejects.toBeInstanceOf(SincronizacaoParcial); // em fatias
    expect(await sincronizarClientes(c)).toBe("2 clientes; 1 pedidos com o nome do cliente");
    expect(chamadas.filter((x) => x.call === "ListarClientesResumido").map((x) => x.param)).toEqual([
      { pagina: 1, registros_por_pagina: 100, apenas_importado_api: "N" },
      { pagina: 2, registros_por_pagina: 100, apenas_importado_api: "N" },
    ]);
    const [antigo] = await sql`select cliente from pedidos_venda where omie_id = 777`;
    expect(antigo.cliente).toBe("Fazenda Boa Vista");
    await sincronizarPedidos(c);
    const [novo] = await sql`select cliente from pedidos_venda where omie_id = 778`;
    expect(novo.cliente).toBe("Usina Santa Rita S/A");
  });

  it("a tarefa clientes roda antes de produtos", async () => {
    const ordem: string[] = [];
    const c = new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        ordem.push(JSON.parse(String(init!.body)).call);
        return resposta({});
      },
    });
    await executarSincronizacao({ forcar: ["produtos", "clientes"], cliente: c });
    expect(ordem).toEqual(["ListarClientesResumido", "ListarProdutos"]);
  });
});

describe("estruturas: carteira primeiro, em paralelo e retomável", () => {
  // A (acabado, na carteira) → B (conjunto) → C (peça), estrutura já conhecida.
  // No Omie, A também tem N (filho novo, que ainda não estava na estrutura). X1 e X2 não estão na carteira.
  const OMIE = { A: 940001, B: 940002, C: 940003, X1: 940011, X2: 940012, N: 940013 } as const;
  const nomes = Object.fromEntries(Object.entries(OMIE).map(([k, v]) => [v, k])) as Record<number, string>;
  const malha: Record<number, number[]> = { [OMIE.A]: [OMIE.B, OMIE.N], [OMIE.B]: [OMIE.C] };
  const ids: Record<string, number> = {};

  const cliente = (opcoes: { atraso?: number; falharEm?: string; registro?: string[]; simultaneas?: { agora: number; max: number } } = {}) =>
    new ClienteOmie({
      appKey: "k",
      appSecret: "s",
      estado: memoria(),
      fetchFn: async (_u, init) => {
        const id = JSON.parse(String(init!.body)).param[0].idProduto as number;
        opcoes.registro?.push(nomes[id]);
        const s = opcoes.simultaneas;
        if (s) s.max = Math.max(s.max, ++s.agora);
        await new Promise((r) => setTimeout(r, opcoes.atraso ?? 0));
        if (s) s.agora--;
        if (opcoes.falharEm === nomes[id]) return resposta({ faultstring: "ERROR: falha temporária no Omie", faultcode: "SOAP-ENV:Server" }, 500);
        return resposta({ ident: { idProduto: id }, itens: (malha[id] ?? []).map((f) => ({ idProdMalha: f, codProdMalha: `EST-${nomes[f]}`, quantProdMalha: 1 })) });
      },
    });

  beforeAll(async () => {
    // só os itens deste teste entram na fila
    await sql`update itens set ativo = false where origem = 'fabricado' and omie_id is not null`;
    for (const k of ["A", "B", "C", "X1", "X2", "N"] as const) {
      const tipo = k === "A" ? "produto" : k === "B" ? "conjunto" : "peca";
      const [r] = await sql`insert into itens (codigo, descricao, unidade, tipo, origem, omie_id)
                            values (${`EST-${k}`}, ${`ITEM ${k}`}, 'UN', ${tipo}, 'fabricado', ${OMIE[k]}) returning id`;
      ids[k] = r.id as number;
    }
    await sql`insert into estrutura (pai_id, filho_id, quantidade, fonte) values (${ids.A}, ${ids.B}, 1, 'omie'), (${ids.B}, ${ids.C}, 1, 'omie')`;
    const [pv] = await sql`insert into pedidos_venda (numero, cliente, data_entrega, status) values ('PV-EST', 'Teste', ${somarDias(hojeNoFuso(), 30)}, 'aberto') returning id`;
    await sql`insert into pedido_itens (pedido_id, item_id, quantidade) values (${pv.id}, ${ids.A}, 1)`;
  });

  const limparCursor = () => sql`delete from integracao_estado where entidade = 'cursor:estrutura'`;

  it("lê primeiro o item da carteira, depois os filhos dele e só então o restante, sem reler no ciclo", async () => {
    await limparCursor();
    const registro: string[] = [];
    const simultaneas = { agora: 0, max: 0 };
    const msg = await sincronizarEstrutura(cliente({ atraso: 15, registro, simultaneas }));
    expect(msg).toMatch(/^6 estruturas lidas, 3 linhas/);
    expect(registro[0]).toBe("A"); // item da carteira primeiro
    const pos = (k: string) => registro.indexOf(k);
    for (const k of ["B", "C", "N"]) {
      expect(pos(k)).toBeLessThan(pos("X1")); // filhos (inclusive o novo, N) antes dos demais
      expect(pos(k)).toBeLessThan(pos("X2"));
    }
    expect([...registro].sort()).toEqual(["A", "B", "C", "N", "X1", "X2"]); // nunca relê no mesmo ciclo
    expect(simultaneas.max).toBe(2); // 2 leituras em paralelo
    const [cur] = await sql`select mensagem from integracao_estado where entidade = 'cursor:estrutura'`;
    expect(cur.mensagem).toBeNull();
  });

  it("retoma de onde parou e salva o progresso antes de lançar um erro", async () => {
    await limparCursor();
    const registro: string[] = [];
    const vencido = { ate: Date.now() - 1 }; // prazo esgotado: uma leitura por execução
    await expect(sincronizarEstrutura(cliente({ registro }), vencido)).rejects.toBeInstanceOf(SincronizacaoParcial);
    await expect(sincronizarEstrutura(cliente({ registro }), vencido)).rejects.toThrow(/2 estruturas lidas, faltam 4/);
    await expect(sincronizarEstrutura(cliente({ registro }), vencido)).rejects.toBeInstanceOf(SincronizacaoParcial);
    expect(registro).toEqual(["A", "B", "N"]); // carteira (A, B) e o filho novo revelado por A (N)
    // a próxima execução falha em X1: o que já foi lido (inclusive C, lido em paralelo) fica gravado
    await expect(sincronizarEstrutura(cliente({ registro, falharEm: "X1" }))).rejects.toThrow(/falha temporária/);
    const [salvo] = await sql`select mensagem from integracao_estado where entidade = 'cursor:estrutura'`;
    const cur = JSON.parse(salvo.mensagem as string);
    expect([...cur.feitos].sort()).toEqual([ids.A, ids.B, ids.C, ids.N].sort());
    expect(cur.linhas).toBe(3);
    const antes = registro.length;
    expect(await sincronizarEstrutura(cliente({ registro }))).toBe("6 estruturas lidas, 3 linhas");
    expect(registro.slice(antes).sort()).toEqual(["X1", "X2"]); // retoma sem reler o que já foi feito
  });

  it("aceita o cursor antigo ({ depoisDe }) começando um ciclo novo", async () => {
    await sql`insert into integracao_estado (entidade, mensagem) values ('cursor:estrutura', ${JSON.stringify({ depoisDe: 999999, lidas: 20, linhas: 7, avisos: 0 })})
              on conflict (entidade) do update set mensagem = excluded.mensagem`;
    const registro: string[] = [];
    expect(await sincronizarEstrutura(cliente({ registro }))).toBe("6 estruturas lidas, 3 linhas");
    expect([...registro].sort()).toEqual(["A", "B", "C", "N", "X1", "X2"]);
  });
});
