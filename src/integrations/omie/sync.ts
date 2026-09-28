// Sincronização com o Omie.
// Leitura (Omie → PCP): produtos, estrutura, saldo de estoque, pedidos de venda
// e pedidos de compra. Escrita (PCP → Omie): outbox de OPs e requisições.
//
// Dono de cada dado: o Omie é dono de produto, estrutura, estoque, pedidos e
// compras. O PCP nunca sobrescreve no Omie o que é do Omie; e ao importar,
// nunca sobrescreve a classificação de PCP (tipo, origem, política, lotes).

import { sql, type Sql } from "@/lib/db";
import { hojeNoFuso } from "@/domain/datas";
import { ClienteOmie, ErroOmie, type ArmazemEstado, type EstadoIntegracao } from "./cliente";
import { CONTRATOS, contratoLiberado, type NomeContrato } from "./contratos";
import { lerConfigOmie, type ModoOmie } from "./config";
import {
  extrairListaPedidos,
  extrairListaProdutos,
  extrairPedidosCompra,
  extrairPosicaoEstoque,
  mapearEstrutura,
  mapearPedido,
  mapearPedidoCompra,
  mapearProduto,
  mapearSaldo,
  payloadConcluirOP,
  payloadIncluirOP,
  payloadRequisicaoCompra,
} from "./mapeamento";

export type { ModoOmie };
/** Modo atual: variável OMIE_MODO (se definida) ou o escolhido na tela Integrações. */
export const modoOmie = async (): Promise<ModoOmie> => (await lerConfigOmie()).modo;

export const armazemSql = (chave = "omie:api"): ArmazemEstado => ({
  async ler() {
    const [r] = await sql`select bloqueado_ate, erros_consecutivos, dia, chamadas_dia from integracao_estado where entidade = ${chave}`;
    return (r as unknown as EstadoIntegracao) ?? { bloqueado_ate: null, erros_consecutivos: 0, dia: null, chamadas_dia: 0 };
  },
  async atualizar(mudar, mensagem) {
    await sql.begin(async (tx) => {
      await tx`insert into integracao_estado (entidade) values (${chave}) on conflict do nothing`;
      const [atual] = await tx`select bloqueado_ate, erros_consecutivos, dia, chamadas_dia from integracao_estado where entidade = ${chave} for update`;
      const e = mudar(atual as unknown as EstadoIntegracao);
      await tx`update integracao_estado set bloqueado_ate = ${e.bloqueado_ate}, erros_consecutivos = ${e.erros_consecutivos},
                 dia = ${e.dia}, chamadas_dia = ${e.chamadas_dia}, ultima_execucao = now(),
                 mensagem = coalesce(${mensagem ?? null}, mensagem) where entidade = ${chave}`;
    });
  },
});

export async function criarClienteOmie(fetchFn?: typeof fetch): Promise<ClienteOmie> {
  const cfg = await lerConfigOmie();
  return criarClienteCom(cfg.appKey, cfg.appSecret, fetchFn);
}

export function criarClienteCom(appKey: string, appSecret: string, fetchFn?: typeof fetch, chaveEstado = "omie:api"): ClienteOmie {
  return new ClienteOmie({
    appKey,
    appSecret,
    reqPorMinuto: Number(process.env.OMIE_REQ_POR_MINUTO || 200),
    limiteDiario: Number(process.env.OMIE_LIMITE_DIARIO || 0),
    estado: armazemSql(chaveEstado),
    fetchFn,
  });
}

async function log(entidade: string, direcao: "entrada" | "saida", status: string, mensagem: string, referencia?: string, payload?: unknown) {
  await sql`insert into integracao_log (sistema, direcao, entidade, referencia, status, mensagem, payload)
            values ('omie', ${direcao}, ${entidade}, ${referencia ?? null}, ${status}, ${mensagem}, ${payload === undefined ? null : sql.json(payload as never)})`;
}

async function marcar(entidade: string, ok: boolean, mensagem: string) {
  await sql`
    insert into integracao_estado (entidade, ultima_execucao, ultimo_sucesso, mensagem)
    values (${entidade}, now(), ${ok ? new Date() : null}, ${mensagem})
    on conflict (entidade) do update set ultima_execucao = now(),
      ultimo_sucesso = case when ${ok} then now() else integracao_estado.ultimo_sucesso end, mensagem = excluded.mensagem`;
}

// ---------- classificação de item novo vindo do Omie ----------
export function classificarNovo(p: { codigo: string; descricao: string; tipoItem?: string }) {
  const d = p.descricao.toUpperCase();
  const t = p.tipoItem ?? "";
  if (t === "04") return { tipo: "produto", origem: "fabricado" } as const;
  if (/^(CJ|UN|CONJ)\b/.test(d) || t === "03" || t === "06") return { tipo: /^(CJ|UN|CONJ)\b/.test(d) ? "conjunto" : "peca", origem: "fabricado" } as const;
  if (t === "01" || t === "02") return { tipo: "materia_prima", origem: "comprado" } as const;
  return { tipo: "componente_comprado", origem: "comprado" } as const;
}

// ---------- leituras ----------
export async function sincronizarProdutos(c: ClienteOmie) {
  let novos = 0,
    atualizados = 0;
  for await (const bruto of c.paginar(
    CONTRATOS.listarProdutos,
    (pagina) => ({ pagina, registros_por_pagina: 100, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" }),
    extrairListaProdutos,
  )) {
    const p = mapearProduto(bruto);
    if (!p) continue;
    const cls = classificarNovo({ ...p, tipoItem: (bruto as Record<string, string>).tipoItem });
    const [r] = await sql`
      insert into itens (codigo, descricao, unidade, tipo, origem, omie_id, revisar, ativo)
      values (${p.codigo}, ${p.descricao}, ${p.unidade}, ${cls.tipo}, ${cls.origem}, ${p.omie_id}, true, ${!p.inativo})
      on conflict (codigo) do update set descricao = excluded.descricao, unidade = excluded.unidade,
        omie_id = excluded.omie_id, ativo = excluded.ativo, updated_at = now()
      returning (xmax = 0) as inserido`;
    if (r.inserido) novos++;
    else atualizados++;
  }
  return `${novos} novos, ${atualizados} atualizados`;
}

export async function sincronizarEstrutura(c: ClienteOmie) {
  const pais = await sql<{ id: number; codigo: string; omie_id: number }[]>`
    select id, codigo, omie_id from itens where ativo and origem = 'fabricado' and omie_id is not null`;
  const porOmie = new Map((await sql<{ id: number; omie_id: number }[]>`select id, omie_id from itens where omie_id is not null`).map((r) => [r.omie_id, r.id]));
  let linhas = 0;
  const avisos: string[] = [];
  for (const pai of pais) {
    const resp = await c.chamar<Record<string, unknown>>(CONTRATOS.consultarEstrutura, { idProduto: pai.omie_id }, { listagem: true });
    const est = mapearEstrutura(resp);
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`delete from estrutura where pai_id = ${pai.id} and fonte = 'omie'`;
      for (const l of est) {
        const filho = porOmie.get(l.filho_omie_id);
        if (!filho) {
          avisos.push(`${pai.codigo}: componente Omie ${l.filho_codigo || l.filho_omie_id} não importado`);
          continue;
        }
        await t`insert into estrutura (pai_id, filho_id, quantidade, perda_pct, fonte)
                values (${pai.id}, ${filho}, ${l.quantidade}, ${l.perda_pct}, 'omie')
                on conflict (pai_id, filho_id) do update set quantidade = excluded.quantidade, perda_pct = excluded.perda_pct,
                  fonte = 'omie', updated_at = now()`;
        linhas++;
      }
    });
  }
  return `${pais.length} estruturas lidas, ${linhas} linhas${avisos.length ? `; ${avisos.length} avisos: ${avisos.slice(0, 5).join("; ")}` : ""}`;
}

export async function sincronizarEstoque(c: ClienteOmie) {
  const local = process.env.OMIE_LOCAL_ESTOQUE ? Number(process.env.OMIE_LOCAL_ESTOQUE) : undefined;
  const saldos: { omie_id: number; saldo: number }[] = [];
  const hoje = hojeNoFuso().split("-").reverse().join("/");
  for await (const b of c.paginar(
    CONTRATOS.listarPosicaoEstoque,
    (nPagina) => ({ nPagina, nRegPorPagina: 100, dDataPosicao: hoje, cExibeTodos: "N", ...(local ? { codigo_local_estoque: local } : {}) }),
    extrairPosicaoEstoque,
  )) {
    const s = mapearSaldo(b);
    if (s) saldos.push(s);
  }
  // só grava depois de ler todas as páginas: nunca deixa o estoque pela metade
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`update estoque_saldos set quantidade = 0, atualizado_em = now() where fonte = 'omie'`;
    for (const s of saldos) {
      await t`insert into estoque_saldos (item_id, quantidade, fonte, atualizado_em)
              select id, ${s.saldo}, 'omie', now() from itens where omie_id = ${s.omie_id}
              on conflict (item_id) do update set quantidade = excluded.quantidade, fonte = 'omie', atualizado_em = now()`;
    }
  });
  return `${saldos.length} saldos`;
}

export async function sincronizarPedidos(c: ClienteOmie) {
  const faturado = (process.env.OMIE_ETAPAS_FATURADO ?? "60,70,80").split(",").map((s) => s.trim());
  let n = 0;
  for await (const b of c.paginar(
    CONTRATOS.listarPedidosVenda,
    (pagina) => ({ pagina, registros_por_pagina: 100, apenas_importado_api: "N" }),
    extrairListaPedidos,
  )) {
    const p = mapearPedido(b);
    if (!p || !p.data_entrega) continue;
    const status = p.cancelado ? "cancelado" : faturado.includes(p.etapa) ? "atendido" : "aberto";
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [ped] = await t`
        insert into pedidos_venda (numero, cliente, data_emissao, data_entrega, status, omie_id)
        values (${p.numero}, ${p.cliente}, ${p.data_emissao ?? p.data_entrega}, ${p.data_entrega}, ${status}, ${p.omie_id})
        on conflict (omie_id) do update set cliente = excluded.cliente, data_entrega = excluded.data_entrega,
          status = excluded.status, updated_at = now()
        returning id`;
      for (const i of p.itens) {
        await t`insert into pedido_itens (pedido_id, item_id, quantidade)
                select ${ped.id}, id, ${i.quantidade} from itens where omie_id = ${i.produto_omie_id}
                on conflict (pedido_id, item_id) do update set quantidade = excluded.quantidade`;
      }
    });
    n++;
  }
  return `${n} pedidos`;
}

export async function sincronizarCompras(c: ClienteOmie) {
  const recs: ReturnType<typeof mapearPedidoCompra> = [];
  for await (const b of c.paginar(
    CONTRATOS.pesquisarPedidosCompra,
    (nPagina) => ({ nPagina, nRegsPorPagina: 50, lExibirPedidosPendentes: true, lExibirPedidosFaturados: false }),
    extrairPedidosCompra,
  )) recs.push(...mapearPedidoCompra(b));
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await t`update recebimentos_programados set status = 'recebido' where omie_ref is not null and status = 'aberto'`;
    for (const r of recs) {
      await t`insert into recebimentos_programados (item_id, quantidade, data_prevista, documento, status, omie_ref)
              select id, ${r.quantidade_pendente}, ${r.data_prevista ?? hojeNoFuso()}, ${r.documento}, 'aberto', ${r.referencia}
              from itens where omie_id = ${r.produto_omie_id}
              on conflict (omie_ref) do update set quantidade = excluded.quantidade, data_prevista = excluded.data_prevista, status = 'aberto'`;
    }
  });
  return `${recs.length} itens de compra em aberto`;
}

// ---------- escrita (outbox) ----------
interface ItemOutbox {
  id: number;
  tipo: string;
  referencia: string;
  payload: Record<string, unknown>;
  tentativas: number;
}

/** Monta a chamada que seria feita ao Omie para um item da fila. */
export async function montarChamada(o: ItemOutbox): Promise<{ contrato: NomeContrato; param: Record<string, unknown> } | { erro: string }> {
  if (o.tipo === "incluir_op" || o.tipo === "concluir_op" || o.tipo === "cancelar_op") {
    const [op] = await sql`
      select o.numero, o.quantidade, o.data_necessidade, o.qtd_boa, o.omie_id,
        to_char(o.concluida_em at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as concluida_em, i.omie_id as produto_omie_id, i.codigo
      from ordens_producao o join itens i on i.id = o.item_id where o.id = ${o.payload.op_id as number}`;
    if (!op) return { erro: "OP não existe mais" };
    if (o.tipo === "incluir_op") {
      if (!op.produto_omie_id) return { erro: `Produto ${op.codigo} sem vínculo com o Omie (omie_id vazio)` };
      return { contrato: "incluirOP", param: payloadIncluirOP(op as never) };
    }
    if (o.tipo === "concluir_op") return { contrato: "concluirOP", param: payloadConcluirOP(op as never) };
    return { contrato: "excluirOP", param: { cCodIntOP: `PCP-${op.numero}`, nCodOP: op.omie_id ?? undefined } };
  }
  if (o.tipo === "requisicao_compra") {
    const itens = o.payload.itens as { item_id: number; quantidade: number }[];
    const ids = itens.map((i) => i.item_id);
    const omie = new Map((await sql`select id, omie_id, codigo from itens where id = any(${ids})`).map((r) => [r.id as number, r]));
    const semVinculo = ids.filter((i) => !omie.get(i)?.omie_id).map((i) => omie.get(i)?.codigo ?? i);
    if (semVinculo.length) return { erro: `Itens sem vínculo com o Omie: ${semVinculo.join(", ")}` };
    return {
      contrato: "incluirRequisicaoCompra",
      param: payloadRequisicaoCompra({
        referencia: o.referencia,
        data: o.payload.data as string,
        itens: itens.map((i) => ({ produto_omie_id: omie.get(i.item_id)!.omie_id as number, quantidade: i.quantidade })),
      }),
    };
  }
  return { erro: `Tipo desconhecido: ${o.tipo}` };
}

export async function processarOutbox(c: ClienteOmie, limite = 20) {
  const { validados } = await lerConfigOmie();
  const itens = await sql<ItemOutbox[]>`
    select id, tipo, referencia, payload, tentativas from outbox
    where sistema = 'omie' and status = 'pendente' and proxima_tentativa <= now()
    order by id limit ${limite}`;
  let enviados = 0,
    falhas = 0;
  for (const o of itens) {
    // conclusão/cancelamento só depois de a inclusão ter ido
    if (o.tipo !== "incluir_op" && o.tipo !== "requisicao_compra") {
      const [inc] = await sql`select status from outbox where sistema = 'omie' and tipo = 'incluir_op' and referencia = ${o.referencia}`;
      if (inc && inc.status !== "enviado") continue;
    }
    const ch = await montarChamada(o);
    if ("erro" in ch) {
      await falhar(o, ch.erro, true);
      falhas++;
      continue;
    }
    if (!contratoLiberado(ch.contrato, validados)) {
      await sql`update outbox set ultimo_erro = ${`Aguardando validação do método ${CONTRATOS[ch.contrato].call} (marque como validado na tela Integrações)`},
                updated_at = now() where id = ${o.id}`;
      continue;
    }
    try {
      const resp = await c.chamar<Record<string, unknown>>(CONTRATOS[ch.contrato], ch.param);
      await sql`update outbox set status = 'enviado', resposta = ${sql.json(resp as never)}, tentativas = tentativas + 1,
                ultimo_erro = null, updated_at = now() where id = ${o.id}`;
      if (o.tipo === "incluir_op") {
        const nCodOP = Number((resp as Record<string, unknown>).nCodOP ?? 0) || null;
        if (nCodOP) await sql`update ordens_producao set omie_id = ${nCodOP} where id = ${o.payload.op_id as number}`;
      }
      await log(o.tipo, "saida", "ok", "enviado", o.referencia, ch.param);
      enviados++;
    } catch (e) {
      const err = e as ErroOmie;
      if (err.tipo === "circuito" || err.tipo === "limite_diario") break;
      await falhar(o, err.message, false);
      falhas++;
    }
  }
  return `${enviados} enviados, ${falhas} com erro`;
}

async function falhar(o: ItemOutbox, msg: string, definitivo: boolean) {
  const tent = o.tentativas + 1;
  const esperaMin = Math.min(240, 2 ** tent);
  const status = definitivo || tent >= 8 ? "erro" : "pendente";
  // nunca rebaixa um envio que já foi confirmado
  await sql`update outbox set tentativas = ${tent}, ultimo_erro = ${msg}, status = ${status},
            proxima_tentativa = now() + ${`${esperaMin} minutes`}::interval, updated_at = now() where id = ${o.id} and status <> 'enviado'`;
  await log(o.tipo, "saida", "erro", msg, o.referencia);
}

// ---------- orquestração ----------
const INTERVALOS_MIN: Record<string, number> = {
  produtos: 60,
  estrutura: 24 * 60,
  estoque: 10,
  pedidos: 10,
  compras: 30,
  outbox: 0,
};

const TAREFAS: Record<string, (c: ClienteOmie) => Promise<string>> = {
  produtos: sincronizarProdutos,
  estrutura: sincronizarEstrutura,
  estoque: sincronizarEstoque,
  pedidos: sincronizarPedidos,
  compras: sincronizarCompras,
  outbox: (c) => processarOutbox(c),
};

export async function executarSincronizacao(opcoes: { forcar?: string[]; cliente?: ClienteOmie } = {}) {
  const modo = await modoOmie();
  if (modo !== "ativo") return [{ entidade: "omie", ok: false, mensagem: `Integração em modo "${modo}": nada foi chamado` }];
  // uma sincronização por vez (cron, botão manual e execuções longas não se sobrepõem):
  // a trava é de sessão, então usa uma conexão reservada do pool
  const conexao = await sql.reserve();
  try {
    const [{ ok }] = await conexao`select pg_try_advisory_lock(4244) as ok`;
    if (!ok) return [{ entidade: "omie", ok: false, mensagem: "Já existe uma sincronização em andamento" }];
    try {
      return await sincronizarSemTrava(opcoes);
    } finally {
      await conexao`select pg_advisory_unlock(4244)`;
    }
  } finally {
    conexao.release();
  }
}

async function sincronizarSemTrava(opcoes: { forcar?: string[]; cliente?: ClienteOmie }) {
  const c = opcoes.cliente ?? (await criarClienteOmie());
  const estados = new Map(
    (await sql`select entidade, ultimo_sucesso from integracao_estado where entidade like 'omie:%'`).map((r) => [r.entidade as string, r.ultimo_sucesso as Date | null]),
  );
  const resultado: { entidade: string; ok: boolean; mensagem: string }[] = [];
  for (const [ent, fn] of Object.entries(TAREFAS)) {
    const ultimo = estados.get(`omie:${ent}`);
    const vencido = !ultimo || Date.now() - new Date(ultimo).getTime() >= INTERVALOS_MIN[ent] * 60_000;
    if (!(opcoes.forcar?.includes(ent) || (!opcoes.forcar && vencido))) continue;
    try {
      const msg = await fn(c);
      await marcar(`omie:${ent}`, true, msg);
      if (ent !== "outbox") await log(ent, "entrada", "ok", msg);
      resultado.push({ entidade: ent, ok: true, mensagem: msg });
    } catch (e) {
      const msg = (e as Error).message;
      await marcar(`omie:${ent}`, false, msg);
      await log(ent, ent === "outbox" ? "saida" : "entrada", "erro", msg);
      resultado.push({ entidade: ent, ok: false, mensagem: msg });
      if ((e as ErroOmie).tipo === "circuito" || (e as ErroOmie).tipo === "limite_diario") break;
    }
  }
  return resultado;
}

// ---------- teste de conexão ----------
/**
 * Faz uma única leitura leve (1 produto) com as credenciais informadas.
 * Usa um disjuntor separado ("omie:teste") para que credenciais erradas
 * digitadas na tela não pausem a sincronização normal.
 */
export async function testarConexao(appKey: string, appSecret: string, fetchFn?: typeof fetch): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const c = criarClienteCom(appKey, appSecret, fetchFn, "omie:teste");
    const r = await c.chamar<Record<string, unknown>>(
      CONTRATOS.listarProdutos,
      { pagina: 1, registros_por_pagina: 1, apenas_importado_api: "N", filtrar_apenas_omiepdv: "N" },
      { listagem: true },
    );
    const total = Number(r.total_de_registros ?? 0);
    await sql`update integracao_estado set bloqueado_ate = null, erros_consecutivos = 0 where entidade = 'omie:teste'`;
    return { ok: true, mensagem: `Conexão OK: o Omie respondeu (${total} produtos cadastrados)` };
  } catch (e) {
    await sql`update integracao_estado set bloqueado_ate = null where entidade = 'omie:teste'`;
    return { ok: false, mensagem: `O Omie recusou a conexão: ${(e as Error).message}` };
  }
}
