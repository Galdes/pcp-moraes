import { createHash } from 'node:crypto';
import { sql, type Sql } from '@/lib/db';
import { hojeNoFuso, formatarOmie } from '@/domain/datas';
import { fimMes, mesesDemanda, serieDemanda } from '@/domain/tendencia';
import { lerConfigOmie } from '@/integrations/omie/config';
import { criarClienteOmie } from '@/integrations/omie/sync';
import { CONTRATOS } from '@/integrations/omie/contratos';
import type { ClienteOmie } from '@/integrations/omie/cliente';
import { mapearNota, paginaNotas, type LinhaNota } from '@/integrations/omie/notas';

export async function demandaDisponivel() {
  const [r] = await sql`select to_regclass('public.demanda_lotes') is not null as ok`;
  return !!r.ok;
}
async function origemAtual() {
  const cfg = await lerConfigOmie();
  return { cfg, origem: createHash('sha256').update(cfg.appKey).digest('hex') };
}

/** Uma página por chamada: retomável e sem disparar nenhuma escrita no Omie. */
export async function importarPaginaDemanda(opcoes: { cliente?: ClienteOmie; hoje?: string } = {}): Promise<{ concluido: boolean; mensagem: string; aguardar?: boolean }> {
  if (!await demandaDisponivel()) throw new Error('Aplique a migração 002_tendencia antes de importar');
  const { cfg, origem } = await origemAtual();
  if (!cfg.appKey || cfg.modo !== 'ativo') throw new Error('Conecte e ative a leitura do Omie antes de importar');
  const hoje = opcoes.hoje ?? hojeNoFuso(), meses = mesesDemanda(hoje);
  let loteId: number | null = null;
  // A transação mantém a conexão física durante a página, inclusive com pooler.
  // A trava se libera no commit/rollback; não depende de estado de sessão reutilizada.
  return sql.begin(async conexao => {
    const [{ ok }] = await conexao`select pg_try_advisory_xact_lock(4252) as ok`;
    if (!ok) return { concluido: false, aguardar: true, mensagem: 'Outra importação histórica está em andamento' };
    try {
      const lotes = await sql`select * from demanda_lotes where origem = ${origem} and mes >= ${meses[0]} and mes <= ${meses.at(-1)!} order by id desc`;
      let lote = lotes.find(l => !l.concluido_em);
      if (!lote) {
        // Uma rodada diária revalida os 24 meses, capturando cancelamentos tardios.
        const mes = meses.find(m => !lotes.some(l => l.mes === m && l.concluido_em &&
          new Date(l.concluido_em as Date).getTime() > Date.now() - 86_400_000 && String(l.ate) >= (fimMes(m) < hoje ? fimMes(m) : hoje)));
        if (!mes) return { concluido: true, mensagem: '24 meses atualizados nesta rodada' };
        [lote] = await sql`insert into demanda_lotes(origem, mes, ate) values (${origem}, ${mes}, ${fimMes(mes) < hoje ? fimMes(mes) : hoje}) returning *`;
      }
      if (!lote) throw new Error('Não foi possível iniciar o lote histórico');
      loteId = Number(lote.id);
      const pagina = Number(lote.proxima_pagina);
      const c = opcoes.cliente ?? await criarClienteOmie();
      const resposta = await c.chamar<Record<string, unknown>>(CONTRATOS.listarNotas, {
        pagina, registros_por_pagina: 50, ordenar_por: 'CODIGO',
        dEmiInicial: formatarOmie(String(lote.mes)), dEmiFinal: formatarOmie(String(lote.ate)),
        tpAmb: '1', cDetalhesPedido: 'S', cApenasResumo: 'N',
      }, { listagem: true });
      const r = paginaNotas(resposta);
      if (pagina > 1 && (Number(lote.total_documentos) !== r.total || Number(lote.total_paginas) !== r.paginas)) {
        // Retoma do início se a coleção mudar enquanto é paginada; mantém o snapshot publicado.
        await sql.begin(async tx => {
          await tx`delete from demanda_linhas where lote_id = ${loteId!}`;
          await tx`update demanda_lotes set proxima_pagina=1, documentos_lidos=0, total_paginas=null, total_documentos=null where id=${loteId!}`;
        });
        throw new Error('A listagem mudou durante a importação. A próxima tentativa reinicia este mês');
      }
      const linhas = r.notas.flatMap(mapearNota);
      if (linhas.some(l => l.data_emissao < String(lote.mes) || l.data_emissao > String(lote.ate))) throw new Error('Omie retornou NF fora do intervalo solicitado');
      const ids = r.notas.map(n => Number((n.compl as Record<string, unknown>).nIdNF));
      if (new Set(ids).size !== ids.length) throw new Error('NF duplicada na mesma página');
      const pronto = pagina === r.paginas;
      const lidas = Number(lote.documentos_lidos) + r.notas.length;
      if (pagina > r.paginas || (pronto && lidas !== r.total) || (!pronto && !r.notas.length)) throw new Error('Paginação incompleta; mês não publicado');
      await sql.begin(async tx => {
        const t = tx as unknown as Sql;
        const repetidas = ids.length ? await t`select 1 from demanda_linhas where lote_id=${loteId!} and nf_id=any(${ids}) limit 1` : [];
        if (repetidas.length) throw new Error('NF repetida entre páginas; confira a ordenação da origem');
        if (linhas.length) await t`insert into demanda_linhas ${t(linhas.map(l => ({ lote_id: loteId!, ...l })))}`;
        await t`update demanda_lotes set proxima_pagina=${pagina+1}, total_paginas=${r.paginas}, total_documentos=${r.total},
          documentos_lidos=${lidas}, concluido_em=${pronto ? new Date() : null}, erro=null, atualizado_em=now() where id=${loteId!}`;
      });
      return { concluido: false, mensagem: `${String(lote.mes).slice(0,7)} · página ${pagina}/${r.paginas} · ${lidas}/${r.total} notas${pronto ? ' · mês publicado' : ''}` };
    } catch(e) {
      if (loteId) await sql`update demanda_lotes set erro=${(e as Error).message.slice(0,500)}, atualizado_em=now() where id=${loteId}`;
      throw e;
    }
  });
}

export async function lerDemanda() {
  const hoje = hojeNoFuso();
  if (!await demandaDisponivel()) return { disponivel: false as const, hoje };
  const { origem, cfg } = await origemAtual();
  const inicio = mesesDemanda(hoje)[0];
  const lotes = await sql`select distinct on (mes) * from demanda_lotes where origem=${origem} and mes>=${inicio}
    and concluido_em is not null order by mes, concluido_em desc, id desc`;
  const ids = lotes.map(l => Number(l.id));
  const linhas = ids.length ? await sql`select d.*, i.id as item_id, i.familia_demanda, i.revisar, i.origem as origem_item
    from demanda_linhas d left join itens i on i.omie_id=d.produto_omie_id where d.lote_id=any(${ids})` : [];
  const [pendente] = await sql`select mes, erro, proxima_pagina, total_paginas, atualizado_em from demanda_lotes
    where origem=${origem} and mes>=${inicio} and concluido_em is null order by id limit 1`;
  return { disponivel: true as const, hoje, lotes, linhas, pendente, conectado: !!cfg.appKey };
}

export type DadosDemanda = Awaited<ReturnType<typeof lerDemanda>>;
export type LinhaAnalitica = LinhaNota & { item_id: number | null; familia_demanda: string | null; revisar: boolean | null };

export function recortarDemanda(dados: Extract<DadosDemanda, { disponivel: true }>, filtro: string) {
  const linhas = dados.linhas as unknown as LinhaAnalitica[];
  const escolhidas = linhas.filter(l => filtro.startsWith('familia:')
    ? l.familia_demanda === filtro.slice(8)
    : String(l.produto_omie_id) === filtro.replace('item:', ''));
  const vendas = escolhidas.filter(l => l.natureza === 'venda');
  const unidades = [...new Set(vendas.map(l => l.unidade))];
  const totais = new Map<string, number>();
  for (const l of vendas) {
    const mes = `${l.data_emissao.slice(0,7)}-01`;
    totais.set(mes, (totais.get(mes) ?? 0) + Number(l.quantidade));
  }
  const cobertura = new Map(dados.lotes.map(l => [String(l.mes), String(l.ate)]));
  // Operações pendentes do recorte impedem publicar totais potencialmente subestimados.
  for (const l of escolhidas.filter(l => l.natureza === 'pendente' || (filtro.startsWith('familia:') && l.revisar !== false))) cobertura.delete(`${l.data_emissao.slice(0,7)}-01`);
  return { serie: serieDemanda(dados.hoje, totais, cobertura), unidades, vendas,
    devolucoes: escolhidas.filter(l => l.natureza === 'devolucao').length,
    pendencias: escolhidas.filter(l => l.natureza === 'pendente').length };
}
