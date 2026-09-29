# Tendência mensal de demanda

O painel mostra 24 meses de quantidades faturadas por item ou família comercial revisada, com média móvel de três meses completos. O mês atual é parcial; meses sem importação completa aparecem como lacunas. A média descreve o histórico e não é uma previsão de vendas nem uma recomendação automática de produção.

## Dados e critérios

- Fonte: Omie `ListarNF`, por data de emissão, ambiente de produção. Somente leitura do ERP.
- Vendas normais (operações 11/12) e CFOPs 5101, 5102, 5105, 5106, 6101, 6102, 6105, 6106, 7101 e 7102 entram na quantidade bruta faturada.
- Cancelamentos, inutilizações, denegações, remessas e operações identificadas como não comerciais são excluídos. Devoluções ficam separadas; não são abatidas automaticamente da necessidade produtiva.
- CFOPs/operações desconhecidos e dados incompletos ficam pendentes para conferência. Uma pendência no recorte interrompe a linha daquele mês.
- Famílias são definidas no cadastro dos itens e exigem classificação revisada. Unidades diferentes impedem a soma. A mesma unidade, por si só, não garante esforço produtivo equivalente: a família deve agrupar itens comparáveis.
- Um mês sem documentos só vale zero depois que todas as páginas forem recebidas. Reimportações substituem o snapshot mensal completo, sem somar novamente os documentos.
- A empresa de origem é identificada por hash da app key. O cadastro industrial continua sendo de uma única empresa; trocar a empresa no Omie exige revisar a correspondência dos itens.

## Instalação e operação

1. Aplicar `npm run db:migrate` com a `DATABASE_URL` do ambiente correto ou publicar e usar **Integrações → Preparar base histórica**, disponível exclusivamente ao administrador. A ação aplica somente a migração 002, em transação, com trava e registro de auditoria; repetir não duplica a estrutura. Não usar `db:reset` ou `--reset` em produção. A migração 002 é aditiva.
2. Publicar a aplicação. Sem a migração, o painel informa que a base precisa ser preparada.
3. Em Integrações, um usuário admin/PCP inicia a importação de demanda. Ela percorre uma página por chamada, pode ser pausada e retomada e não altera pedidos, OPs, estoque ou MRP.
4. Conferir os totais, exclusões e pendências com o relatório fiscal do Omie antes de usar os dados no planejamento. Validar especialmente kits, CFOPs, cancelamentos e devoluções reais da empresa.
5. Para atualização recorrente, um agendador externo pode chamar `POST /api/cron/demanda` com `Authorization: Bearer <CRON_SECRET>`. Cada chamada processa uma página. Não há agendamento automático incluído. Nunca colocar o segredo no navegador ou no repositório.

A carga inicial considera o mês atual e os 23 anteriores. Depois, os meses são renovados quando o snapshot tem mais de 24 horas, capturando alterações retroativas. A importação tem trava para evitar duas cargas concorrentes. Snapshots antigos são mantidos para auditoria; uma política de retenção deverá ser definida conforme o volume.

## Uso para PCP e limites

Usar a tendência para antecipar revisão de capacidade, materiais e prazos por família. Para converter quantidade em carga por setor, ainda são necessários roteiros, tempos, estrutura, estoques confiáveis e lead times. Carteira aberta e faturamento representam momentos diferentes e não devem ser somados diretamente.

A sincronização de pedidos passa a somar linhas repetidas do mesmo item; suas regras anteriores de etapas, entrega e cancelamento continuam precisando de validação operacional. Este módulo não estima sazonalidade futura, não cria OPs e não dispara compras.

## Validação

Testes de domínio cobrem intervalos, lacunas, mês parcial, média móvel, operações fiscais, dados inválidos e itens repetidos. O teste de banco cobre retomada após falha, publicação apenas de meses completos, reimportação sem duplicação, revisão de família e separação de origem. A rotina de CI usa PostgreSQL 16, verificação de tipos, testes e build.
