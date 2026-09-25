-- =====================================================================
-- PCP Moraes · esquema inicial
-- Convenções: nomes de domínio em português, snake_case, toda tabela de
-- negócio com created_at/updated_at. Quantidades em numeric (sem erro de
-- arredondamento de float). Datas de negócio em date; eventos em timestamptz.
-- =====================================================================

-- ---------- Acesso ----------
create type perfil_usuario as enum ('admin', 'diretoria', 'pcp', 'lider', 'operador', 'visualizador');

create table setores (
  id            serial primary key,
  codigo        text not null unique,
  nome          text not null,
  sequencia     int  not null default 0,          -- ordem no fluxo (corte antes de solda...)
  recursos      int  not null default 1 check (recursos > 0),   -- postos/pessoas em paralelo
  horas_turno   numeric(5,2) not null default 8.8 check (horas_turno > 0),
  eficiencia    numeric(4,3) not null default 0.85 check (eficiencia > 0 and eficiencia <= 1),
  eh_gargalo    boolean not null default false,   -- OEE completo só no gargalo
  ativo         boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table usuarios (
  id          serial primary key,
  nome        text not null,
  login       text not null unique,               -- e-mail (escritório) ou matrícula (chão)
  senha_hash  text,
  pin_hash    text,                               -- PIN de 4 a 6 dígitos para o posto (tablet)
  perfil      perfil_usuario not null,
  setor_id    int references setores(id),
  ativo       boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (senha_hash is not null or pin_hash is not null)
);

create table sessoes (
  token_hash  text primary key,                   -- guardamos só o hash do token
  usuario_id  int not null references usuarios(id) on delete cascade,
  expira_em   timestamptz not null,
  created_at  timestamptz not null default now()
);
create index on sessoes (usuario_id);

create table tentativas_login (             -- trava força bruta (PIN tem só 4 a 6 dígitos)
  id          bigserial primary key,
  login       text not null,
  sucesso     boolean not null,
  created_at  timestamptz not null default now()
);
create index on tentativas_login (lower(login), created_at desc);

-- ---------- Calendário e capacidade ----------
create table calendario_excecoes (           -- feriados, sábados trabalhados, paradas coletivas
  data       date primary key,
  horas      numeric(5,2) not null default 0, -- 0 = não trabalha; >0 = horas do dia
  descricao  text not null
);

create table indisponibilidades (            -- ex.: máquina em adequação NR12
  id                     serial primary key,
  setor_id               int not null references setores(id),
  inicio                 date not null,
  fim                    date not null,
  recursos_indisponiveis int not null default 1 check (recursos_indisponiveis > 0),
  motivo                 text not null,
  created_at             timestamptz not null default now(),
  check (fim >= inicio)
);

-- ---------- Engenharia ----------
create type tipo_item     as enum ('produto', 'conjunto', 'peca', 'materia_prima', 'componente_comprado');
create type origem_item   as enum ('fabricado', 'comprado');
create type politica_item as enum ('sob_pedido', 'supermercado');

create table itens (
  id                serial primary key,
  codigo            text not null unique,
  descricao         text not null,
  unidade           text not null default 'UN',
  tipo              tipo_item not null,
  origem            origem_item not null,
  politica          politica_item not null default 'sob_pedido',
  lead_time_dias    int not null default 0 check (lead_time_dias >= 0),  -- compra ou fabricação
  estoque_seguranca numeric(14,4) not null default 0,
  estoque_min       numeric(14,4) not null default 0,   -- supermercado: ponto de reposição
  estoque_max       numeric(14,4) not null default 0,   -- supermercado: repõe até aqui
  lote_minimo       numeric(14,4) not null default 0,
  lote_multiplo     numeric(14,4) not null default 0,
  omie_id           bigint unique,
  revisar           boolean not null default false,  -- importado do Omie: conferir tipo/origem/política
  ativo             boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (not (origem = 'comprado' and tipo in ('produto', 'conjunto'))),
  check (estoque_max >= estoque_min)
);
create index on itens (tipo);

create table estrutura (                   -- lista de materiais (BOM), um nível por linha
  id          serial primary key,
  pai_id      int not null references itens(id) on delete cascade,
  filho_id    int not null references itens(id),
  quantidade  numeric(14,6) not null check (quantidade > 0),
  perda_pct   numeric(5,2) not null default 0 check (perda_pct >= 0 and perda_pct < 100),
  fonte       text not null default 'manual' check (fonte in ('manual', 'omie')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (pai_id, filho_id),
  check (pai_id <> filho_id)
);
create index on estrutura (filho_id);

create table roteiros (                    -- operações de fabricação de um item
  id              serial primary key,
  item_id         int not null references itens(id) on delete cascade,
  sequencia       int not null,
  setor_id        int not null references setores(id),
  descricao       text not null,
  setup_min       numeric(10,2) not null default 0 check (setup_min >= 0),
  tempo_unit_min  numeric(10,3) not null default 0 check (tempo_unit_min >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (item_id, sequencia)
);

-- ---------- Estoque e demanda (espelho do Omie) ----------
create table estoque_saldos (
  item_id       int primary key references itens(id) on delete cascade,
  quantidade    numeric(14,4) not null default 0,
  fonte         text not null default 'manual' check (fonte in ('manual', 'omie')),
  atualizado_em timestamptz not null default now()
);

create table pedidos_venda (
  id            serial primary key,
  numero        text not null unique,
  cliente       text not null,
  data_emissao  date not null default current_date,
  data_entrega  date not null,
  status        text not null default 'aberto' check (status in ('aberto', 'atendido', 'cancelado')),
  omie_id       bigint unique,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table pedido_itens (
  id          serial primary key,
  pedido_id   int not null references pedidos_venda(id) on delete cascade,
  item_id     int not null references itens(id),
  quantidade  numeric(14,4) not null check (quantidade > 0),
  unique (pedido_id, item_id)
);

create table recebimentos_programados (    -- pedidos de compra em aberto
  id             serial primary key,
  item_id        int not null references itens(id),
  quantidade     numeric(14,4) not null check (quantidade > 0),
  data_prevista  date not null,
  documento      text not null,
  status         text not null default 'aberto' check (status in ('aberto', 'recebido', 'cancelado')),
  omie_ref       text unique,
  created_at     timestamptz not null default now()
);
create index on recebimentos_programados (item_id) where status = 'aberto';

-- ---------- Ordens de produção ----------
create type status_op  as enum ('sugerida', 'firmada', 'liberada', 'em_processo', 'concluida', 'cancelada');
create type origem_op  as enum ('pedido', 'supermercado', 'manual', 'mrp');
create sequence op_numero_seq start 1001;

create table ordens_producao (
  id                  serial primary key,
  numero              int not null unique default nextval('op_numero_seq'),
  item_id             int not null references itens(id),
  quantidade          numeric(14,4) not null check (quantidade > 0),
  origem              origem_op not null,
  pedido_item_id      int references pedido_itens(id),
  status              status_op not null default 'firmada',
  prioridade          int not null default 0,          -- maior = antes
  data_necessidade    date not null,                   -- data prometida
  inicio_previsto     timestamptz,
  fim_previsto        timestamptz,                     -- saída da programação finita
  qtd_boa             numeric(14,4) not null default 0,
  qtd_refugo          numeric(14,4) not null default 0,
  observacao          text,
  falta_assumida_por  int references usuarios(id),     -- liberada com falta de material
  falta_assumida_obs  text,
  liberada_em         timestamptz,
  iniciada_em         timestamptz,
  concluida_em        timestamptz,
  omie_id             bigint,
  created_by          int references usuarios(id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on ordens_producao (status);
create index on ordens_producao (item_id);

create type status_tarefa as enum ('pendente', 'em_processo', 'pausada', 'concluida');

create table tarefas (                     -- operação de um componente dentro de uma OP
  id                  serial primary key,
  op_id               int not null references ordens_producao(id) on delete cascade,
  item_id             int not null references itens(id),
  roteiro_id          int references roteiros(id) on delete set null,
  setor_id            int not null references setores(id),
  sequencia           int not null,
  nivel               int not null,           -- 0 = item da OP; maior = mais profundo
  descricao           text not null,
  quantidade          numeric(14,4) not null,
  tempo_previsto_min  numeric(12,2) not null,
  status              status_tarefa not null default 'pendente',
  fila_manual         int,                    -- prioridade manual no setor (1 = primeiro)
  inicio_previsto     timestamptz,
  fim_previsto        timestamptz,
  iniciada_em         timestamptz,
  concluida_em        timestamptz,
  qtd_boa             numeric(14,4) not null default 0,
  qtd_refugo          numeric(14,4) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index on tarefas (op_id);
create index on tarefas (setor_id, status);

create table tarefa_dependencias (
  tarefa_id      int not null references tarefas(id) on delete cascade,
  depende_de_id  int not null references tarefas(id) on delete cascade,
  primary key (tarefa_id, depende_de_id),
  check (tarefa_id <> depende_de_id)
);
create index on tarefa_dependencias (depende_de_id);

create table op_materiais (                -- kit: comprados e itens de supermercado
  op_id           int not null references ordens_producao(id) on delete cascade,
  item_id         int not null references itens(id),
  qtd_necessaria  numeric(14,4) not null,
  primary key (op_id, item_id)
);

-- ---------- Apontamento ----------
create table motivos_parada (
  id         serial primary key,
  codigo     text not null unique,
  descricao  text not null,
  tipo       text not null check (tipo in ('planejada', 'setup', 'quebra', 'falta_material', 'qualidade', 'organizacional')),
  ativo      boolean not null default true
);

create table motivos_refugo (
  id         serial primary key,
  codigo     text not null unique,
  descricao  text not null,
  ativo      boolean not null default true
);

create table apontamentos (                -- um intervalo de trabalho numa tarefa
  id                serial primary key,
  tarefa_id         int not null references tarefas(id) on delete cascade,
  usuario_id        int not null references usuarios(id),
  inicio            timestamptz not null,
  fim               timestamptz,
  qtd_boa           numeric(14,4) not null default 0 check (qtd_boa >= 0),
  qtd_refugo        numeric(14,4) not null default 0 check (qtd_refugo >= 0),
  motivo_refugo_id  int references motivos_refugo(id),
  created_at        timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index on apontamentos (tarefa_id);
create unique index apontamento_aberto_por_tarefa on apontamentos (tarefa_id) where fim is null;

create table paradas (
  id          serial primary key,
  setor_id    int not null references setores(id),
  tarefa_id   int references tarefas(id) on delete set null,
  motivo_id   int not null references motivos_parada(id),
  usuario_id  int not null references usuarios(id),
  inicio      timestamptz not null,
  fim         timestamptz,
  observacao  text,
  created_at  timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index on paradas (setor_id, inicio);

create table acoes_idempotentes (          -- tablet reenviando a mesma ação não duplica
  chave       text primary key,
  resultado   jsonb not null,
  created_at  timestamptz not null default now()
);

-- ---------- Programa semanal (aprovado pela diretoria) ----------
create table programas_semanais (
  id            serial primary key,
  semana        date not null unique,       -- segunda-feira
  status        text not null default 'rascunho' check (status in ('rascunho', 'aprovado')),
  aprovado_por  int references usuarios(id),
  aprovado_em   timestamptz,
  observacao    text,
  created_at    timestamptz not null default now()
);

create table programa_itens (
  programa_id  int not null references programas_semanais(id) on delete cascade,
  tarefa_id    int not null references tarefas(id) on delete cascade,
  primary key (programa_id, tarefa_id)
);

-- ---------- MRP ----------
create table mrp_execucoes (
  id                 serial primary key,
  executado_em       timestamptz not null default now(),
  executado_por      int references usuarios(id),
  horizonte_semanas  int not null,
  semana_inicial     date not null,
  avisos             jsonb not null default '[]'
);

create table mrp_linhas (
  execucao_id            int not null references mrp_execucoes(id) on delete cascade,
  item_id                int not null references itens(id),
  semana                 int not null,
  bruta                  numeric(14,4) not null,
  recebimentos           numeric(14,4) not null,
  estoque_projetado      numeric(14,4) not null,
  liquida                numeric(14,4) not null,
  recebimento_planejado  numeric(14,4) not null,
  liberacao_planejada    numeric(14,4) not null,
  primary key (execucao_id, item_id, semana)
);

create table sugestoes (
  id                serial primary key,
  execucao_id       int not null references mrp_execucoes(id) on delete cascade,
  tipo              text not null check (tipo in ('compra', 'producao')),
  item_id           int not null references itens(id),
  quantidade        numeric(14,4) not null,
  data_liberacao    date not null,
  data_necessidade  date not null,
  atrasada          boolean not null default false,  -- liberação já deveria ter ocorrido
  status            text not null default 'aberta' check (status in ('aberta', 'convertida', 'descartada')),
  op_id             int references ordens_producao(id),
  created_at        timestamptz not null default now()
);

-- ---------- Integrações ----------
create table integracao_estado (
  entidade            text primary key,
  ultima_execucao     timestamptz,
  ultimo_sucesso      timestamptz,
  erros_consecutivos  int not null default 0,
  bloqueado_ate       timestamptz,
  dia                 date,
  chamadas_dia        int not null default 0,
  mensagem            text
);

create table integracao_log (
  id          bigserial primary key,
  sistema     text not null,
  direcao     text not null check (direcao in ('entrada', 'saida')),
  entidade    text not null,
  referencia  text,
  status      text not null check (status in ('ok', 'erro', 'simulado', 'ignorado')),
  mensagem    text,
  payload     jsonb,
  created_at  timestamptz not null default now()
);
create index on integracao_log (created_at desc);

create table outbox (                      -- envios ao Omie: idempotentes e com repetição
  id                 bigserial primary key,
  sistema            text not null,
  tipo               text not null,
  referencia         text not null,
  payload            jsonb not null,
  status             text not null default 'pendente' check (status in ('pendente', 'enviado', 'erro', 'cancelado')),
  tentativas         int not null default 0,
  proxima_tentativa  timestamptz not null default now(),
  ultimo_erro        text,
  resposta           jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (sistema, tipo, referencia)
);

create table auditoria (
  id           bigserial primary key,
  usuario_id   int references usuarios(id),
  entidade     text not null,
  entidade_id  text not null,
  acao         text not null,
  dados        jsonb,
  created_at   timestamptz not null default now()
);
create index on auditoria (entidade, entidade_id);
