import { sql, type Sql } from '@/lib/db';
import { auditar } from './auditoria';
import { ErroDominio } from '@/domain/tipos';

// Cópia fixa da migração 002, conferida pelo teste. Não aceita SQL do navegador.
export const MIGRACAO_DEMANDA = `
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
`;

/** Exclusivamente chamado pela ação autenticada de administrador. Tudo ou nada. */
export async function prepararBaseDemanda(usuarioId: number | null) {
  return sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(4251)`;
    await tx`set local lock_timeout = '5s'`;
    const [estado] = await tx`select to_regclass('public.demanda_lotes') as lotes,
      to_regclass('public.demanda_linhas') as linhas, to_regclass('public._migracoes') as controle,
      exists(select 1 from information_schema.columns where table_schema='public' and table_name='itens' and column_name='familia_demanda') as familia`;
    if (estado.lotes && estado.linhas && estado.familia) return false;
    if (estado.lotes || estado.linhas || estado.familia) throw new ErroDominio('Estrutura de demanda parcial. Solicite conferência técnica antes de continuar.');
    await tx.unsafe(MIGRACAO_DEMANDA);
    if (estado.controle) await tx`insert into _migracoes(nome) values ('002_tendencia.sql') on conflict do nothing`;
    await auditar(usuarioId, 'sistema', '002_tendencia.sql', 'preparar_demanda', undefined, tx as unknown as Sql);
    return true;
  });
}
