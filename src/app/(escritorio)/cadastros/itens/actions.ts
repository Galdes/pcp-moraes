"use server";
import { exigir, PODE_PLANEJAR } from "@/server/auth";
import { executar, inteiro, numero, texto } from "@/lib/acao";
import { sql, type Sql } from "@/lib/db";
import { ErroDominio } from "@/domain/tipos";
import { encontrarCiclos } from "@/domain/estrutura";
import { carregarEstrutura } from "@/server/engenharia";
import { auditar } from "@/server/auditoria";
import { demandaDisponivel } from "@/server/demanda";

const TIPOS = ["produto", "conjunto", "peca", "materia_prima", "componente_comprado"];

async function camposItem(f: FormData) {
  const tipo = texto(f, "tipo");
  const origem = texto(f, "origem");
  const politica = texto(f, "politica") || "sob_pedido";
  if (!TIPOS.includes(tipo)) throw new ErroDominio("Tipo inválido");
  if (!["fabricado", "comprado"].includes(origem)) throw new ErroDominio("Origem inválida");
  if (!["sob_pedido", "supermercado"].includes(politica)) throw new ErroDominio("Política inválida");
  const min = numero(f, "estoque_min");
  const max = numero(f, "estoque_max");
  if (politica === "supermercado" && !(max > min)) throw new ErroDominio("Supermercado precisa de máximo maior que o mínimo");
  return {
    ...(await demandaDisponivel() ? { familia_demanda: texto(f, "familia_demanda").slice(0, 100) } : {}),
    descricao: texto(f, "descricao"),
    unidade: (texto(f, "unidade") || "UN").toUpperCase(),
    tipo,
    origem,
    politica,
    lead_time_dias: inteiro(f, "lead_time_dias"),
    estoque_seguranca: numero(f, "estoque_seguranca"),
    estoque_min: min,
    estoque_max: max,
    lote_minimo: numero(f, "lote_minimo"),
    lote_multiplo: numero(f, "lote_multiplo"),
  };
}

export async function novoItemAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  await executar("/cadastros/itens", async () => {
    const c = await camposItem(f);
    const codigo = texto(f, "codigo");
    if (!codigo || !c.descricao) throw new ErroDominio("Código e descrição são obrigatórios");
    const [r] = await sql`insert into itens ${sql({ codigo, ...c })} returning id`;
    await auditar(u.id, "item", r.id as number, "criado");
    return { destino: `/cadastros/itens/${r.id}`, mensagem: "Item criado" };
  });
}

export async function salvarItemAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const id = inteiro(f, "id");
  await executar(`/cadastros/itens/${id}`, async () => {
    const c = await camposItem(f);
    await sql`update itens set ${sql({ ...c, revisar: false, ativo: f.get("ativo") === "on" })}, updated_at = now() where id = ${id}`;
    await auditar(u.id, "item", id, "alterado", c);
    return "Item salvo";
  });
}

export async function addComponenteAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const pai = inteiro(f, "pai_id");
  await executar(`/cadastros/itens/${pai}#estrutura`, async () => {
    const cod = texto(f, "filho_codigo");
    const [filho] = await sql`select id from itens where codigo = ${cod.split(" · ")[0].trim()}`;
    if (!filho) throw new ErroDominio(`Item ${cod} não encontrado`);
    const q = numero(f, "quantidade");
    if (!(q > 0)) throw new ErroDominio("Quantidade deve ser maior que zero");
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`insert into estrutura (pai_id, filho_id, quantidade, perda_pct) values (${pai}, ${filho.id}, ${q}, ${numero(f, "perda_pct")})
              on conflict (pai_id, filho_id) do update set quantidade = excluded.quantidade, perda_pct = excluded.perda_pct, fonte = 'manual', updated_at = now()`;
      const ciclos = encontrarCiclos(await carregarEstrutura(t));
      if (ciclos.length) throw new ErroDominio("Esse componente criaria uma estrutura circular (o item acabaria contendo a si mesmo)");
    });
    await auditar(u.id, "item", pai, "estrutura+", { filho: cod, q });
    return "Componente incluído";
  });
}

export async function removerComponenteAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const pai = inteiro(f, "pai_id");
  await executar(`/cadastros/itens/${pai}#estrutura`, async () => {
    await sql`delete from estrutura where pai_id = ${pai} and filho_id = ${inteiro(f, "filho_id")}`;
    await auditar(u.id, "item", pai, "estrutura-", { filho: inteiro(f, "filho_id") });
    return "Componente removido";
  });
}

export async function salvarOperacaoAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const item = inteiro(f, "item_id");
  await executar(`/cadastros/itens/${item}#roteiro`, async () => {
    const dados = {
      item_id: item,
      sequencia: inteiro(f, "sequencia"),
      setor_id: inteiro(f, "setor_id"),
      descricao: texto(f, "descricao"),
      setup_min: numero(f, "setup_min"),
      tempo_unit_min: numero(f, "tempo_unit_min"),
    };
    if (!dados.descricao || !dados.setor_id || !dados.sequencia) throw new ErroDominio("Sequência, setor e descrição são obrigatórios");
    const id = inteiro(f, "id");
    if (id) await sql`update roteiros set ${sql(dados)}, updated_at = now() where id = ${id}`;
    else await sql`insert into roteiros ${sql(dados)}`;
    await auditar(u.id, "item", item, "roteiro", dados);
    return "Roteiro salvo (OPs já liberadas mantêm o tempo antigo)";
  });
}

export async function removerOperacaoAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const item = inteiro(f, "item_id");
  await executar(`/cadastros/itens/${item}#roteiro`, async () => {
    await sql`delete from roteiros where id = ${inteiro(f, "id")} and item_id = ${item}`;
    await auditar(u.id, "item", item, "roteiro-", { id: inteiro(f, "id") });
    return "Operação removida";
  });
}

export async function saldoManualAction(f: FormData) {
  const u = await exigir(...PODE_PLANEJAR);
  const item = inteiro(f, "item_id");
  await executar(`/cadastros/itens/${item}`, async () => {
    const [s] = await sql`select fonte from estoque_saldos where item_id = ${item}`;
    if (s?.fonte === "omie") throw new ErroDominio("Saldo deste item vem do Omie: ajuste lá");
    await sql`insert into estoque_saldos (item_id, quantidade, fonte) values (${item}, ${numero(f, "quantidade")}, 'manual')
              on conflict (item_id) do update set quantidade = excluded.quantidade, atualizado_em = now()`;
    await auditar(u.id, "item", item, "saldo_manual", { q: numero(f, "quantidade") });
    return "Saldo atualizado";
  });
}
