// Contratos (endpoint + método) usados com a API do Omie.
//
// "verificado" indica se o nome do método e os campos foram confirmados em
// documentação pública do Omie durante o desenvolvimento. Métodos de ESCRITA
// não verificados ficam bloqueados até alguém validar no Portal do
// Desenvolvedor (developer.omie.com.br, com a chave da Moraes) e incluir o nome
// na variável OMIE_CONTRATOS_VALIDADOS. Assim nenhuma chamada "no escuro"
// altera o ERP.

export interface Contrato {
  endpoint: string;
  call: string;
  escrita: boolean;
  verificado: boolean;
  fonte: string;
}

export const CONTRATOS = {
  listarNotas: {
    endpoint: "produtos/nfconsultar/",
    call: "ListarNF",
    escrita: false,
    verificado: true,
    fonte: "Documentação oficial NFConsultar: dEmiInicial/dEmiFinal, tpAmb, cDetalhesPedido, nfCadastro (29/09/2026)",
  },
  listarProdutos: {
    endpoint: "geral/produtos/",
    call: "ListarProdutos",
    escrita: false,
    verificado: true,
    fonte: "Lista de APIs Omie + cliente público omie_python_api (pagina, registros_por_pagina, apenas_importado_api, filtrar_apenas_omiepdv)",
  },
  consultarEstrutura: {
    endpoint: "geral/malha/",
    call: "ConsultarEstrutura",
    escrita: false,
    verificado: false,
    fonte: "Endpoint confirmado na Lista de APIs; nomes dos campos a confirmar no portal",
  },
  listarPosicaoEstoque: {
    endpoint: "estoque/consulta/",
    call: "ListarPosEstoque",
    escrita: false,
    verificado: true,
    fonte: "cliente público omie_python_api (nPagina, nRegPorPagina, dDataPosicao, cExibeTodos, codigo_local_estoque)",
  },
  listarPedidosVenda: {
    endpoint: "produtos/pedido/",
    call: "ListarPedidos",
    escrita: false,
    verificado: true,
    fonte: "cliente público omie_python_api (pagina, registros_por_pagina, apenas_importado_api)",
  },
  listarClientesResumido: {
    endpoint: "geral/clientes/",
    call: "ListarClientesResumido",
    escrita: false,
    verificado: false,
    fonte: "Lista de APIs Omie (geral/clientes/); parâmetros pagina, registros_por_pagina, apenas_importado_api e retorno clientes_cadastro_resumido a confirmar no portal",
  },
  pesquisarPedidosCompra: {
    endpoint: "produtos/pedidocompra/",
    call: "PesquisarPedCompra",
    escrita: false,
    verificado: false,
    fonte: "Artigo Ajuda Omie 'Criando um Pedido de Compra por API' cita o método; parâmetros a confirmar",
  },
  incluirOP: {
    endpoint: "produtos/op/",
    call: "IncluirOrdemProducao",
    escrita: true,
    verificado: true,
    fonte: "Artigo Ajuda Omie 'Controle de Lote e Validade via API' (identificacao: cCodIntOP, dDtPrevisao, nCodProduto, nQtde)",
  },
  concluirOP: {
    endpoint: "produtos/op/",
    call: "ConcluirOrdemProducao",
    escrita: true,
    verificado: false,
    fonte: "Nome e campos a confirmar no portal (conclusão da OP gera a movimentação de estoque no Omie)",
  },
  excluirOP: {
    endpoint: "produtos/op/",
    call: "ExcluirOrdemProducao",
    escrita: true,
    verificado: false,
    fonte: "Nome e campos a confirmar no portal",
  },
  incluirRequisicaoCompra: {
    endpoint: "produtos/requisicaocompra/",
    call: "IncluirReq",
    escrita: true,
    verificado: false,
    fonte: "Endpoint confirmado na Lista de APIs; método e campos a confirmar no portal",
  },
} satisfies Record<string, Contrato>;

export type NomeContrato = keyof typeof CONTRATOS;

export function contratoLiberado(nome: NomeContrato, validadosEnv = process.env.OMIE_CONTRATOS_VALIDADOS ?? ""): boolean {
  const c: Contrato = CONTRATOS[nome];
  if (!c.escrita || c.verificado) return true;
  return validadosEnv
    .split(",")
    .map((s) => s.trim())
    .includes(c.call);
}
