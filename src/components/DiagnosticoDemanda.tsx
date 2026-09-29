import { Card, Vazio } from './ui';
import { ImportarDemanda } from './ImportarDemanda';
import { lerDemanda } from '@/server/demanda';
import { fmtDataHora, fmtNum } from '@/lib/formato';
import { mesesDemanda } from '@/domain/tendencia';

export async function DiagnosticoDemanda({ podeImportar }: { podeImportar: boolean }) {
  const dados = await lerDemanda();
  return <div id="demanda" className="mt-4"><Card titulo="Histórico de demanda · notas fiscais">
    {!dados.disponivel ? <Vazio>Aplique a migração 002_tendencia antes de importar o histórico.</Vazio> : <>
      <p className="mb-3 text-sm">Importação independente da carteira e das OPs. Cada mês só é publicado após ler todas as páginas. Repetir a importação substitui o snapshot do mês, sem somar vendas novamente.</p>
      {podeImportar && <ImportarDemanda />}
      {dados.pendente && <p className="my-3 text-sm text-atencao">Em andamento: {String(dados.pendente.mes).slice(0,7)} · próxima página {String(dados.pendente.proxima_pagina)}{dados.pendente.erro ? ` · ${String(dados.pendente.erro)}` : ''}</p>}
      <div className="mt-3 overflow-x-auto"><table className="tbl"><thead><tr><th>Mês</th><th>Cobertura</th><th>Notas</th><th>Linhas de venda</th><th>Devoluções</th><th>Pendentes</th><th>Excluídas</th><th>Valor de produtos vendidos*</th><th>Atualizado</th></tr></thead><tbody>
        {mesesDemanda(dados.hoje).map(mes => {
          const lote = dados.lotes.find(l => l.mes === mes);
          const linhas = lote ? dados.linhas.filter(l => l.lote_id === lote.id) : [];
          const vendas = linhas.filter(l => l.natureza === 'venda');
          return <tr key={mes}><td>{mes.slice(0,7)}</td><td>{lote ? `até ${String(lote.ate)}` : 'Não importado'}</td><td>{lote ? String(lote.documentos_lidos) : '—'}</td><td>{lote ? vendas.length : '—'}</td><td>{lote ? linhas.filter(l => l.natureza === 'devolucao').length : '—'}</td><td>{lote ? linhas.filter(l => l.natureza === 'pendente').length : '—'}</td><td>{lote ? linhas.filter(l => l.natureza === 'excluida').length : '—'}</td><td>{lote ? fmtNum(vendas.reduce((s,l) => s + Number(l.valor),0),2) : '—'}</td><td>{lote ? fmtDataHora(lote.concluido_em as Date) : '—'}</td></tr>;
        })}
      </tbody></table></div>
      <p className="mt-2 text-xs text-apagado">* Valor dos produtos menos desconto, sem frete e tributos adicionais; venda bruta antes das devoluções. Controle para conferência com o Omie, não total da NF. Família comercial é mantida em Itens e estruturas.</p>
      <details className="mt-3 text-xs"><summary className="cursor-pointer">Ver linhas pendentes ou excluídas (primeiras 100)</summary><div className="overflow-x-auto"><table className="tbl"><thead><tr><th>NF / item</th><th>Código</th><th>Operação / CFOP</th><th>Motivo</th></tr></thead><tbody>{dados.linhas.filter(l => ['pendente','excluida'].includes(String(l.natureza))).slice(0,100).map(l => <tr key={`${l.lote_id}:${l.nf_id}:${l.linha_id}`}><td>{String(l.nf_id)} / {String(l.linha_id)}</td><td>{String(l.codigo)}</td><td>{String(l.operacao)} / {String(l.cfop)}</td><td>{String(l.motivo)}</td></tr>)}</tbody></table></div></details>
      <p className="mt-3 text-xs text-apagado">Leitura da mesma conta Omie conectada. Trocar de conta separa o histórico. Operações sem classificação não entram na curva; devoluções são mostradas separadamente. Confira a conciliação antes de usar o histórico para decisões.</p>
    </>}
  </Card></div>;
}
