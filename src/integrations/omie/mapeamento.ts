// Tradução entre os registros do Omie e o modelo do PCP.
// Todo acesso a campo do Omie passa por "campo()", que aceita nomes
// alternativos: se o Omie devolver o campo com outro nome, o ajuste é aqui,
// num lugar só, e os testes de contrato apontam a diferença.

import { deOmie, formatarOmie } from "@/domain/datas";

type Obj = Record<string, unknown>;

export function campo<T = unknown>(o: unknown, ...nomes: string[]): T | undefined {
  if (!o || typeof o !== "object") return undefined;
  for (const n of nomes) {
    const partes = n.split(".");
    let v: unknown = o;
    for (const p of partes) v = v && typeof v === "object" ? (v as Obj)[p] : undefined;
    if (v !== undefined && v !== null && v !== "") return v as T;
  }
  return undefined;
}

const num = (v: unknown) => (v === undefined || v === null || v === "" ? 0 : Number(String(v).replace(",", ".")));

// ---------- Leitura ----------

export interface ProdutoOmie {
  omie_id: number;
  codigo: string;
  descricao: string;
  unidade: string;
  inativo: boolean;
}

export function mapearProduto(p: Obj): ProdutoOmie | null {
  const omie_id = num(campo(p, "codigo_produto", "nCodProd"));
  const codigo = String(campo(p, "codigo", "cCodigo") ?? "").trim();
  if (!omie_id || !codigo) return null;
  return {
    omie_id,
    codigo,
    descricao: String(campo(p, "descricao", "cDescricao") ?? codigo).trim(),
    unidade: String(campo(p, "unidade", "cUnidade") ?? "UN").trim().toUpperCase(),
    inativo: campo(p, "inativo") === "S",
  };
}

export function extrairListaProdutos(r: Obj) {
  return {
    registros: (campo<Obj[]>(r, "produto_servico_cadastro") ?? []) as Obj[],
    totalPaginas: num(campo(r, "total_de_paginas")),
  };
}

export interface LinhaEstruturaOmie {
  filho_omie_id: number;
  filho_codigo: string;
  quantidade: number;
  perda_pct: number;
}

export function mapearEstrutura(r: Obj): LinhaEstruturaOmie[] {
  const itens = (campo<Obj[]>(r, "itens", "malha", "estrutura") ?? []) as Obj[];
  return itens
    .map((i) => ({
      filho_omie_id: num(campo(i, "idProdMalha", "nIdProdutoMalha", "codigo_produto")),
      filho_codigo: String(campo(i, "codProdMalha", "cCodigo", "codigo") ?? ""),
      quantidade: num(campo(i, "quantProdMalha", "nQtde", "quantidade")),
      perda_pct: num(campo(i, "percPerdaProdMalha", "perda")),
    }))
    .filter((l) => l.filho_omie_id && l.quantidade > 0);
}

export interface SaldoOmie {
  omie_id: number;
  codigo: string;
  saldo: number;
}

export function extrairPosicaoEstoque(r: Obj) {
  return {
    registros: (campo<Obj[]>(r, "produtos") ?? []) as Obj[],
    totalPaginas: num(campo(r, "nTotPaginas", "total_de_paginas")),
  };
}

export function mapearSaldo(p: Obj): SaldoOmie | null {
  const omie_id = num(campo(p, "nCodProd", "codigo_produto"));
  if (!omie_id) return null;
  return { omie_id, codigo: String(campo(p, "cCodigo", "codigo") ?? ""), saldo: num(campo(p, "nSaldo", "fisico", "saldo")) };
}

export interface PedidoOmie {
  omie_id: number;
  numero: string;
  cliente: string;
  data_emissao: string | null;
  data_entrega: string | null;
  etapa: string;
  cancelado: boolean;
  itens: { produto_omie_id: number; quantidade: number }[];
}

export function extrairListaPedidos(r: Obj) {
  return {
    registros: (campo<Obj[]>(r, "pedido_venda_produto") ?? []) as Obj[],
    totalPaginas: num(campo(r, "total_de_paginas")),
  };
}

export function mapearPedido(p: Obj): PedidoOmie | null {
  const cab = campo<Obj>(p, "cabecalho") ?? {};
  const omie_id = num(campo(cab, "codigo_pedido"));
  if (!omie_id) return null;
  const det = (campo<Obj[]>(p, "det") ?? []) as Obj[];
  return {
    omie_id,
    numero: String(campo(cab, "numero_pedido") ?? omie_id),
    cliente: String(campo(p, "informacoes_adicionais.nome_cliente", "cabecalho.nome_cliente") ?? `Cliente Omie ${campo(cab, "codigo_cliente") ?? "?"}`),
    data_emissao: deOmie(campo(p, "infoCadastro.dInc", "cabecalho.data_emissao") as string),
    data_entrega: deOmie(campo(cab, "data_previsao") as string),
    etapa: String(campo(cab, "etapa") ?? ""),
    cancelado: campo(p, "infoCadastro.cancelado") === "S",
    itens: det
      .map((d) => ({ produto_omie_id: num(campo(d, "produto.codigo_produto")), quantidade: num(campo(d, "produto.quantidade")) }))
      .filter((i) => i.produto_omie_id && i.quantidade > 0),
  };
}

export interface RecebimentoOmie {
  referencia: string;
  documento: string;
  produto_omie_id: number;
  quantidade_pendente: number;
  data_prevista: string | null;
}

export function extrairPedidosCompra(r: Obj) {
  return {
    registros: (campo<Obj[]>(r, "pedidos_pesquisa") ?? []) as Obj[],
    totalPaginas: num(campo(r, "nTotalPaginas", "nTotPaginas")),
  };
}

export function mapearPedidoCompra(p: Obj): RecebimentoOmie[] {
  const cab = campo<Obj>(p, "cabecalho_consulta", "cabecalho") ?? {};
  const nCodPed = num(campo(cab, "nCodPed"));
  const produtos = (campo<Obj[]>(p, "produtos_consulta", "produtos") ?? []) as Obj[];
  return produtos
    .map((i, idx) => ({
      referencia: `${nCodPed}:${campo(i, "nCodItem") ?? idx}`,
      documento: `PC ${campo(cab, "cNumero") ?? nCodPed}`,
      produto_omie_id: num(campo(i, "nCodProd")),
      quantidade_pendente: num(campo(i, "nQtde")) - num(campo(i, "nQtdeRec")),
      data_prevista: deOmie(campo(cab, "dDtPrevisao") as string),
    }))
    .filter((x) => x.produto_omie_id && x.quantidade_pendente > 0);
}

// ---------- Escrita ----------

export function payloadIncluirOP(op: { numero: number; data_necessidade: string; quantidade: number; produto_omie_id: number }) {
  return {
    identificacao: {
      cCodIntOP: `PCP-${op.numero}`,
      dDtPrevisao: formatarOmie(op.data_necessidade),
      nCodProduto: op.produto_omie_id,
      nQtde: op.quantidade,
    },
  };
}

export function payloadConcluirOP(op: { numero: number; omie_id: number | null; concluida_em: string; qtd_boa: number }) {
  return {
    cCodIntOP: `PCP-${op.numero}`,
    nCodOP: op.omie_id ?? undefined,
    dDtConclusao: formatarOmie(op.concluida_em),
    nQtdeProduzida: op.qtd_boa,
  };
}

export function payloadRequisicaoCompra(r: { referencia: string; data: string; itens: { produto_omie_id: number; quantidade: number; obs?: string }[] }) {
  return {
    codIntReqCompra: r.referencia,
    dtSugestao: formatarOmie(r.data),
    obsReqCompra: "Gerada pelo MRP do PCP",
    ItensReqCompra: r.itens.map((i) => ({ codProd: i.produto_omie_id, qtde: i.quantidade, obsItem: i.obs ?? "" })),
  };
}
