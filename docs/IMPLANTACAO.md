# Roteiro de implantação na Moraes

O software é a parte menor. O que faz o PCP funcionar é dado confiável e rotina de gestão.

## Semana 0 · Preparação (1 a 2 semanas)
- Gemba nos 6 setores: confirmar setores, recursos (pessoas/postos em paralelo), turno e o gargalo provável.
- Omie: confirmar o plano (limite de API), se o módulo de Produção está ativo, se as estruturas estão cadastradas com os códigos `01.10.xx` e se os locais de estoque separam almoxarifado, em processo e acabado.
- Escolher o **piloto**: CA VIBRO 810 + um produto de linha.
- Inventário cíclico dos itens do kit do piloto até acuracidade de 95% ou mais.

## Fatia 1 · Cadastros e leitura do Omie (3 a 4 semanas)
- Importar produtos e estruturas do Omie (modo ativo só para leitura, escrita em simulação).
- Completar roteiros e tempos do piloto com o Cristiano e os líderes. Zerar as pendências críticas da tela **Qualidade dos dados**.
- Definir supermercado (itens, mínimo e máximo) das peças comuns.

## Fatia 2 · Apontamento e OEE (3 a 4 semanas)
- Tablets nos setores, QR nas fichas, PIN dos operadores.
- Meta de disciplina: cada registro em menos de 30 segundos, na hora (não no fim do turno).
- Após 2 a 3 semanas: confirmar o gargalo com dados e recalibrar os tempos padrão.

## Fatia 3 · Programação, Kanban e rituais (3 a 4 semanas)
- **Daily de produção** (15 min, em frente à TV): o que parou ontem, o que trava hoje, quem resolve.
- **Reunião semanal de PCP** (sexta): carga x capacidade das próximas 4 semanas, OPs em risco, aprovação do programa pela diretoria.

## Fatia 4 · MRP e compras (4 a 5 semanas)
- Validar no portal do Omie `IncluirReq` e `ConcluirOrdemProducao`; liberar em `OMIE_CONTRATOS_VALIDADOS`.
- MRP semanal (segunda cedo) → requisições para Compras.
- Indicador de acompanhamento: faltas de material que travam OPs.

## Critérios de sucesso (medir antes e depois)
| Indicador | Base (medir na semana 0) | Meta em 6 meses |
|---|---|---|
| Entregas no prazo (OTD) | ? | ≥ 90% |
| Aderência ao programa semanal | – | ≥ 85% |
| Lead time da máquina | ? | −30% |
| OPs liberadas com falta de material | ? | < 10% |
| OEE do gargalo | – | ≥ 65% |
