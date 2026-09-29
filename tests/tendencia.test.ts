import { describe, it, expect } from 'vitest';
import { mesesDemanda, fimMes, serieDemanda, agregarItensPedido } from '@/domain/tendencia';
import { mapearNota, paginaNotas, reclassificarEntrada } from '@/integrations/omie/notas';

const nota = () => ({
  compl: { nIdNF: 123, nIdPedido: 456 },
  ide: { dEmi: '15/08/2026', tpNF: '1', tpAmb: '1', finNFe: '1' },
  pedido: { opPedido: '11' },
  det: [{ nfProdInt: { nCodProd: 99, nCodItem: 1 }, prod: { cProd: 'ABC', xProd: 'Peça', CFOP: '5.101', qCom: 10, uCom: 'UN', vProd: 200, vDesc: 20, indTot: 1 } }],
});
describe('histórico de demanda', () => {
  it('mantém 24 meses consecutivos com ano e limites corretos', () => {
    const meses = mesesDemanda('2026-09-29');
    expect(meses).toHaveLength(24);
    expect(meses[0]).toBe('2024-10-01');
    expect(meses.at(-1)).toBe('2026-09-01');
    expect(fimMes('2024-02-01')).toBe('2024-02-29');
  });
  it('distingue zero de lacuna e não suaviza mês parcial nem lacunas', () => {
    const totais = new Map([['2026-06-01', 3], ['2026-08-01', 9], ['2026-09-01', 100]]);
    const cobertura = new Map([['2026-06-01','2026-06-30'],['2026-07-01','2026-07-31'],['2026-08-01','2026-08-31'],['2026-09-01','2026-09-29']]);
    let s = serieDemanda('2026-09-29', totais, cobertura);
    expect(s.at(-3)?.quantidade).toBe(0);
    expect(s.at(-2)?.media).toBe(4);
    expect(s.at(-1)).toMatchObject({ quantidade: 100, parcial: true, media: null });
    cobertura.delete('2026-07-01');
    s = serieDemanda('2026-09-29', totais, cobertura);
    expect(s.at(-3)?.quantidade).toBeNull();
    expect(s.at(-2)?.media).toBeNull();
  });
  it('não trata uma cobertura antiga do mês corrente como atual', () => {
    expect(serieDemanda('2026-09-29',new Map(),new Map([['2026-09-01','2026-09-28']])).at(-1)?.quantidade).toBeNull();
  });
  it('preserva itens repetidos somando quantidades no modelo operacional agregado', () => {
    expect(agregarItensPedido([{produto_omie_id: 1, quantidade: 2},{produto_omie_id: 1, quantidade: 3}])).toEqual([{produto_omie_id: 1, quantidade: 5}]);
    expect(() => agregarItensPedido([{produto_omie_id: 1, quantidade: NaN}])).toThrow();
  });
  it('mapeia venda por identidade fiscal e unidade, sem somar tributos', () => {
    expect(mapearNota(nota())[0]).toMatchObject({nf_id:123, linha_id:'1:1', produto_omie_id:99, quantidade:10, valor:180, natureza:'venda', data_emissao:'2026-08-15'});
  });
  it('preserva linhas fiscais distintas com o mesmo identificador de integração', () => {
    const n = nota(); n.det.push({...n.det[0], prod:{...n.det[0].prod, qCom:3}});
    const linhas = mapearNota(n);
    expect(linhas.map(l=>l.linha_id)).toEqual(['1:1','1:2']);
    expect(linhas.reduce((s,l)=>s+l.quantidade,0)).toBe(13);
  });
  it('separa entradas e devoluções pelo CFOP inclusive em snapshots anteriores', () => {
    const linha = { natureza:'pendente', cfop:'1102', motivo:'Operação fiscal não classificada' };
    expect(reclassificarEntrada(linha).natureza).toBe('excluida');
    expect(reclassificarEntrada({...linha,cfop:'2201'}).natureza).toBe('devolucao');
    expect(reclassificarEntrada({...linha,cfop:'5551'}).natureza).toBe('pendente');
    expect(reclassificarEntrada({...linha,natureza:'excluida',cfop:'1201'}).natureza).toBe('excluida');
  });
  it('separa cancelamento, remessa, devolução, CFOP desconhecido e componentes sem total', () => {
    const n = nota();
    expect(mapearNota({...n, ide:{...n.ide,dCan:'20/08/2026'}})[0].natureza).toBe('excluida');
    expect(mapearNota({...n, pedido:{opPedido:'14'}})[0].natureza).toBe('excluida');
    expect(mapearNota({...n, pedido:{opPedido:'13'},ide:{...n.ide,finNFe:'4',tpNF:'0'}})[0].natureza).toBe('devolucao');
    n.det[0].prod.CFOP='5551';
    expect(mapearNota(n)[0].natureza).toBe('pendente');
    n.det[0].prod.indTot=0;
    expect(mapearNota(n)[0].natureza).toBe('excluida');
  });
  it('recusa datas impossíveis, totais inválidos e detalhe ausente', () => {
    const n = nota();
    expect(() => mapearNota({...n, ide:{...n.ide,dEmi:'31/02/2026'}})).toThrow();
    expect(() => mapearNota({...n, det:[]})).toThrow();
    n.det[0].prod.qCom=NaN;
    expect(() => mapearNota(n)).toThrow();
    expect(() => paginaNotas({nfCadastro:[]})).toThrow();
    expect(paginaNotas({})).toEqual({notas:[],paginas:1,total:0});
  });
});
