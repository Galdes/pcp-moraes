import Link from 'next/link';
import { Card, Vazio } from './ui';
import { lerDemanda, recortarDemanda, type LinhaAnalitica } from '@/server/demanda';
import { fmtDataHora, fmtQtd } from '@/lib/formato';
import type { PontoDemanda } from '@/domain/tendencia';

const mesBR = (mes: string) => `${mes.slice(5,7)}/${mes.slice(2,4)}`;

export function LinhasDemanda({ serie, unidade }: { serie: PontoDemanda[]; unidade: string }) {
  const largura = 960, altura = 260, margem = 52;
  const max = Math.max(1, ...serie.flatMap(p => [p.quantidade ?? 0, p.media ?? 0]));
  const x = (i: number) => margem + i * (largura - margem - 20) / Math.max(1, serie.length - 1);
  const y = (v: number) => altura - 35 - v / max * (altura - 60);
  function caminho(campo: 'quantidade' | 'media') {
    let aberto = false;
    return serie.map((p,i) => {
      if (p[campo] === null) { aberto = false; return ''; }
      const cmd = aberto ? 'L' : 'M'; aberto = true;
      return `${cmd}${x(i)},${y(p[campo]!)}`;
    }).join(' ');
  }
  return <>
    <div className="overflow-x-auto">
      <svg role="img" aria-label={`Quantidades faturadas mensais em ${unidade}; média móvel de três meses completos`} viewBox={`0 0 ${largura} ${altura}`} className="min-w-[640px] w-full">
        <title>Tendência histórica de demanda · {unidade}</title>
        <desc>Lacunas não são zeros. Mês atual parcial não entra na média móvel. Valores disponíveis na tabela abaixo.</desc>
        {[0,0.25,0.5,0.75,1].map(f => <g key={f}>
          <line x1={margem} x2={largura-20} y1={y(max*f)} y2={y(max*f)} stroke="#d9dfdf" />
          <text x={margem-7} y={y(max*f)+4} textAnchor="end" fontSize="10" fill="#596666">{fmtQtd(max*f)}</text>
        </g>)}
        <path d={caminho('quantidade')} fill="none" stroke="#17646b" strokeWidth="2" />
        <path d={caminho('media')} fill="none" stroke="#a37722" strokeWidth="2.5" strokeDasharray="6 4" />
        {serie.map((p,i) => <g key={p.mes}>
          {p.quantidade !== null && <circle cx={x(i)} cy={y(p.quantidade)} r={p.parcial ? 5 : 3} fill={p.parcial ? 'white' : '#17646b'} stroke="#17646b"><title>{mesBR(p.mes)}: {fmtQtd(p.quantidade)} {unidade}{p.parcial ? ' · parcial' : ''}</title></circle>}
          {i % 2 === 0 || i === serie.length-1 ? <text x={x(i)} y={altura-12} textAnchor="middle" fontSize="10" fill="#596666">{mesBR(p.mes)}</text> : null}
        </g>)}
      </svg>
    </div>
    <div className="flex flex-wrap gap-4 text-xs"><span className="text-[#17646b]">● Quantidade faturada</span><span className="text-[#a37722]">┄ Média móvel de 3 meses completos</span><span>○ Mês parcial</span></div>
    <details className="mt-3 text-xs"><summary className="cursor-pointer">Ver valores mensais</summary>
      <table className="tbl mt-2"><caption className="sr-only">Histórico em {unidade}</caption><thead><tr><th>Mês</th><th>Quantidade</th><th>Média móvel</th><th>Situação</th></tr></thead>
        <tbody>{serie.map(p => <tr key={p.mes}><td>{mesBR(p.mes)}</td><td>{p.quantidade === null ? '—' : fmtQtd(p.quantidade)}</td><td>{p.media === null ? '—' : fmtQtd(p.media)}</td><td>{p.quantidade === null ? 'Sem cobertura suficiente' : p.parcial ? 'Parcial' : 'Mês completo'}</td></tr>)}</tbody>
      </table>
    </details>
  </>;
}

export async function TendenciaDemanda({ filtro = '', preservar = {} }: { filtro?: string; preservar?: Record<string,string|undefined> }) {
  const dados = await lerDemanda();
  const titulo = 'Tendência de demanda · 24 meses';
  const acoes = <Link href="/integracoes#demanda" className="btn-sec btn-xs">Origem dos dados</Link>;
  if (!dados.disponivel) return <Card titulo={titulo} className="mt-4" acoes={acoes}><Vazio>Histórico de demanda ainda não preparado. Solicite a atualização da base do sistema.</Vazio></Card>;
  const linhas = dados.linhas as unknown as LinhaAnalitica[];
  const itens = new Map<number, string>();
  const familias = new Set<string>();
  for (const l of linhas) {
    if (l.produto_omie_id && ['venda','pendente','devolucao'].includes(l.natureza)) itens.set(l.produto_omie_id, `${l.codigo} · ${l.descricao}`);
    if (l.familia_demanda?.trim() && l.revisar === false) familias.add(l.familia_demanda);
  }
  const opcoes = [...itens].sort((a,b) => a[1].localeCompare(b[1], 'pt-BR'));
  const valido = filtro.startsWith('familia:') ? familias.has(filtro.slice(8)) : itens.has(Number(filtro.replace('item:', '')));
  const selecionado = valido ? filtro : opcoes.length ? `item:${opcoes[0][0]}` : '';
  const r = recortarDemanda(dados, selecionado);
  const ultima = dados.lotes.map(l => new Date(l.concluido_em as Date).getTime()).sort((a,b) => b-a)[0];
  const pendencias = linhas.filter(l => l.natureza === 'pendente').length;
  const revisao = linhas.some(l => r.vendas.includes(l) && l.revisar !== false);
  return <Card titulo={titulo} className="mt-4" acoes={acoes}>
    <p className="mb-3 text-sm text-apagado">Vendas faturadas brutas por mês de emissão da NF-e. A tendência histórica apoia o planejamento; não é uma previsão nem a carteira futura.</p>
    {!opcoes.length ? <Vazio>{dados.lotes.length ? 'Nenhuma venda classificada nos meses importados. Confira operações e cobertura em Integrações.' : 'Importe o histórico fiscal em Integrações. Ausência de dados não significa demanda zero.'}</Vazio> : <>
      <form method="get" action="/#tendencia" className="mb-3 flex flex-wrap items-end gap-2">
        {['periodo','de','ate'].map(k => preservar[k] ? <input key={k} type="hidden" name={k} value={preservar[k]} /> : null)}
        <label className="grid gap-1 min-w-0 flex-1"><span className="lbl">Item ou família</span><select name="demanda" defaultValue={selecionado} className="inp max-w-full">
          <optgroup label="Itens">{opcoes.map(([id,nome]) => <option key={id} value={`item:${id}`}>{nome}</option>)}</optgroup>
          {familias.size > 0 && <optgroup label="Famílias revisadas">{[...familias].sort().map(f => <option key={f} value={`familia:${f}`}>{f}</option>)}</optgroup>}
        </select></label><button className="btn-sec">Aplicar</button>
      </form>
      {r.unidades.length > 1 ? <Vazio>Este recorte contém unidades diferentes ({r.unidades.join(', ')}). Selecione um item; as quantidades não serão somadas.</Vazio> : r.serie.some(p => p.quantidade !== null) ? <LinhasDemanda serie={r.serie} unidade={r.unidades[0] ?? 'unidade do item'} /> : <Vazio>Este recorte ainda não tem meses com cobertura suficiente.</Vazio>}
      {revisao && <p className="mt-2 text-xs text-atencao">Classificação do item ainda não revisada. Não utilize esta série para inferir carga de fabricação.</p>}
      {r.devolucoes > 0 && <p className="mt-2 text-xs text-atencao">{r.devolucoes} linhas de devolução no recorte, separadas da quantidade bruta. Não representam venda adicional nem desfazem produção realizada.</p>}
    </>}
    <p className="mt-3 border-t border-linha pt-3 text-xs text-apagado">{dados.lotes.length}/24 meses importados · última publicação {ultima ? fmtDataHora(new Date(ultima)) : 'ainda não realizada'}. Lacunas e meses com operações pendentes não são preenchidos com zero. Mês atual é parcial.</p>
    {pendencias > 0 && <p className="mt-1 text-xs text-atencao">{pendencias} linhas fiscais aguardam classificação na base. Confira o diagnóstico da importação.</p>}
    <p className="mt-1 text-xs text-apagado">Famílias seguem o cadastro atual e exigem revisão dos itens. Quantidades não equivalem a horas de produção; prazos dependem de carteira, estruturas, roteiros, materiais e capacidade.</p>
  </Card>;
}
