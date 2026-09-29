-- Espelho analítico independente: nunca alimenta OPs, estoque ou MRP.
alter table itens add column familia_demanda text not null default '';

create table demanda_lotes (
  id bigserial primary key,
  origem text not null, -- hash da App Key: separa históricos ao trocar de empresa
  mes date not null check (extract(day from mes) = 1),
  ate date not null,
  proxima_pagina int not null default 1,
  total_paginas int,
  total_documentos int,
  documentos_lidos int not null default 0,
  concluido_em timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (ate >= mes)
);
create unique index demanda_lote_aberto on demanda_lotes(origem, mes) where concluido_em is null;
create index on demanda_lotes(origem, mes, concluido_em desc);

create table demanda_linhas (
  lote_id bigint not null references demanda_lotes(id) on delete cascade,
  nf_id bigint not null,
  linha_id text not null,
  produto_omie_id bigint,
  codigo text not null,
  descricao text not null,
  unidade text not null,
  data_emissao date not null,
  pedido_omie_id bigint,
  cfop text not null,
  operacao text not null,
  quantidade numeric(18,6) not null check (quantidade >= 0),
  valor numeric(18,2) not null,
  natureza text not null check (natureza in ('venda', 'devolucao', 'excluida', 'pendente')),
  motivo text not null,
  primary key(lote_id, nf_id, linha_id)
);
create index on demanda_linhas(produto_omie_id, data_emissao);
