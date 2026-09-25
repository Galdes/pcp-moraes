# PCP Moraes · Planejamento e Controle da Produção

Sistema de PCP da **Moraes Equipamentos** (implementos agrícolas), desenhado e construído pela **ESTG · Estratégia · Tecnologia · Gestão**.

Ele cobre o que o Omie não tem na produção: roteiro, centros de trabalho, programação com capacidade, Kanban dos setores, apontamento no tablet, OEE e MRP. Tudo o que mexe em estoque e em dinheiro continua no Omie.

| Módulo | O que faz |
|---|---|
| **Engenharia** | Itens, estrutura multinível, roteiros (setor, setup, minutos por unidade), política **sob pedido** ou **supermercado** (mín/máx), lead time, lotes. Tela de **qualidade dos dados** aponta o que impede o MRP de funcionar. |
| **Pedidos e OPs** | Pedido de venda vira OP (sob encomenda). Explosão da estrutura gera as etapas de cada peça e conjunto, com dependências (peça antes do conjunto, conjunto antes da montagem) e o **kit de materiais**. |
| **Conferência de estoque (kitting)** | Antes de liberar, cruza o kit com o saldo do Omie menos o que outras OPs liberadas já comprometeram. Kit incompleto só libera com responsável e motivo registrados. |
| **Programação** | Capacidade finita por setor (cada recurso é uma raia), respeita dependências, NR12/indisponibilidades, feriados e prioridade manual. Mostra fim previsto x data prometida e **carga x capacidade** por semana. **Programa semanal** aprovado pela diretoria. |
| **Kanban e TV** | Fila por setor (parado / em processo / próximas / aguardando), modo TV para o chão de fábrica com atualização automática. |
| **Posto (tablet)** | Operador entra com matrícula + PIN, lê o QR da ficha, inicia, para (com motivo), retoma e conclui (boas e refugo). Funciona com Wi-Fi instável: fila local com reenvio e chave de idempotência. |
| **Indicadores** | OTD, aderência ao programa, lead time da máquina, WIP, OPs em risco, Pareto de paradas, faltas de material, **OEE do gargalo** e utilização. |
| **MRP** | Baldes semanais, estrutura multinível com peças "fantasma", supermercado por mín/máx, lote mínimo/múltiplo, lead time. Gera sugestões de OP e **requisição de compra no Omie**. |
| **Integrações** | Omie (leitura e escrita com limites, disjuntor e fila de envio) e resumo por máquina para o **Monday** via N8N. |

Veja também [docs/ARQUITETURA.md](docs/ARQUITETURA.md) (decisões, modelo de dados e regras de negócio) e [docs/IMPLANTACAO.md](docs/IMPLANTACAO.md) (roteiro de implantação na fábrica).

---

## Rodar localmente

### Opção A · Docker (recomendado)

```bash
cp .env.example .env          # ajuste CRON_SECRET, EXPORT_TOKEN, TV_TOKEN e DB_SENHA
docker compose up -d --build  # banco + sistema + agendador
docker compose exec app npx tsx scripts/seed.ts          # setores, motivos e usuários
# opcional, dados de demonstração (Vibro 810, pedidos, histórico):
docker compose exec app npx tsx scripts/seed.ts --demo
```

Acesse `http://localhost:3000`.

### Opção B · Node + PostgreSQL instalados

Requisitos: Node 22+ e PostgreSQL 14+.

```bash
npm ci
cp .env.example .env                      # ajuste DATABASE_URL
npm run db:migrate
npx tsx scripts/seed.ts --demo            # ou sem --demo
COOKIE_INSEGURO=1 npm run dev             # http://localhost:3000
```

Em produção: `npm run build && npm start` atrás de HTTPS (o cookie de sessão é `Secure`; `COOKIE_INSEGURO=1` só para testes em http).

### Acessos iniciais

| Perfil | Login | Senha / PIN |
|---|---|---|
| Administrador | `admin` | `trocar123` |
| Diretoria (aprova o programa) | `fernando` | `trocar123` |
| PCP | `pcp` | `trocar123` |
| Líder da solda | `lider.solda` | `trocar123` |
| Operadores (tablet) | `1001` a `1006` | PIN `1234` |

**Troque todas as senhas e PINs antes de colocar em uso** (tela Usuários). A senha inicial pode ser definida com `SENHA_INICIAL` ao rodar o seed.

---

## Integração com o Omie

O Omie é o dono de produtos, estruturas, estoque, pedidos de venda e pedidos de compra. O PCP:

- **lê** do Omie: produtos (60 min), estruturas (1x/dia), saldo (10 min), pedidos de venda (10 min) e pedidos de compra (30 min);
- **escreve** no Omie: inclusão da OP ao liberar, conclusão da OP (o Omie faz a movimentação de estoque) e requisição de compra gerada pelo MRP.

Proteções embutidas: limite por método por minuto (padrão 200; Omie permite 240), no máximo 2 chamadas simultâneas, limite diário opcional (plano Fit: 500/dia), disjuntor que pausa a integração por 10 min depois de 3 erros seguidos (antes do bloqueio de 30 min do Omie), uma sincronização por vez e fila de envio idempotente com repetição.

### Passo a passo para ativar

1. Crie o aplicativo no Omie e copie `APP_KEY` e `APP_SECRET`.
2. Configure `OMIE_APP_KEY`, `OMIE_APP_SECRET`, `OMIE_REQ_POR_MINUTO` e, se o plano for Fit, `OMIE_LIMITE_DIARIO=500`.
3. Comece com `OMIE_MODO=simulacao`: nada é chamado, e a tela **Integrações** mostra exatamente o JSON que seria enviado a cada OP e requisição.
4. **Valide no Portal do Desenvolvedor do Omie** os métodos marcados "validar" na tela Integrações (`ConsultarEstrutura`, `PesquisarPedCompra`, `ConcluirOrdemProducao`, `ExcluirOrdemProducao`, `IncluirReq`). Se algum campo tiver outro nome, o ajuste é em um lugar só: `src/integrations/omie/mapeamento.ts`.
5. Liste os métodos de escrita validados em `OMIE_CONTRATOS_VALIDADOS` (ex.: `ConcluirOrdemProducao,IncluirReq`). Métodos de escrita não validados **nunca** são chamados.
6. Mude para `OMIE_MODO=ativo`. O agendador chama `POST /api/cron/omie` com `Authorization: Bearer CRON_SECRET`.

Itens novos vindos do Omie entram marcados "revisar" (tipo, origem e política são deduzidos). A tela Qualidade dos dados lista o que falta.

## Monday (visão executiva)

O chão de fábrica deixa de ser controlado no Monday. O N8N lê `GET /api/export/monday` (cabeçalho `Authorization: Bearer EXPORT_TOKEN`) e atualiza **um item por máquina** no quadro executivo: status (Planejando, Programado, Em execução, Em atraso, Concluído), % concluído em horas-padrão, data prometida, fim previsto e dias de atraso.

## TV do chão de fábrica

Abra `https://SEU-ENDERECO/tv?token=TV_TOKEN` no navegador da TV. O token só dá acesso de leitura a essa tela.

## Tablets

Abra `/posto` no tablet e adicione à tela inicial (é um PWA). O QR de cada etapa, na **ficha de produção** da OP, abre a etapa direto no tablet. Configure `URL_PUBLICA` com o endereço que os tablets acessam.

---

## Estrutura do código

```
db/migrations/        esquema SQL versionado
scripts/              migrate, seed (base e --demo)
src/domain/           regras puras, sem banco (explosão, MRP, kitting, programação, OEE)
src/server/           serviços com banco (OPs, posto, programação, MRP, indicadores, auth)
src/integrations/     omie/ (cliente, contratos, mapeamento, sync) e monday/
src/app/              telas (Next.js App Router) e rotas de API
tests/                testes de domínio e de integração (PostgreSQL real)
tests/e2e/            roteiros Playwright (posto, offline, escritório, capturas)
```

## Testes

```bash
createdb pcp_test                     # banco só para testes
npm test                              # 33 testes: domínio + integração com PostgreSQL
npm run typecheck
# roteiros de tela (com o sistema rodando e DATABASE_URL apontando para ele):
node tests/e2e/posto.mjs http://localhost:3000
node tests/e2e/offline.mjs http://localhost:3000
node tests/e2e/escritorio.mjs http://localhost:3000
```

## Operação

- **Saúde:** `GET /api/saude` (usar no monitor de disponibilidade).
- **Agendador:** `/api/cron/omie` a cada 5 min e `/api/cron/programacao` a cada 30 min (o `docker-compose.yml` já inclui).
- **Backup:** `pg_dump` diário do banco, com cópia fora do servidor. **Teste a restauração** uma vez por mês: backup não testado não é backup.
- **Auditoria:** toda mudança relevante (OP, estrutura, roteiro, prioridade, usuários) fica na tabela `auditoria`.
- **Segurança:** senhas e PINs com bcrypt; sessão com token aleatório (só o hash fica no banco); bloqueio após 5 tentativas erradas em 15 min; permissão conferida no servidor em toda ação; chaves do Omie só no servidor.

## Variáveis de ambiente

Todas documentadas em [.env.example](.env.example).
