import { campo } from './mapeamento';
import { deOmie } from '@/domain/datas';

type Obj = Record<string, unknown>;
export interface LinhaNota {
  nf_id: number; linha_id: string; produto_omie_id: number | null;
  codigo: string; descricao: string; unidade: string; data_emissao: string;
  pedido_omie_id: number | null; cfop: string; operacao: string;
  quantidade: number; valor: number;
  natureza: 'venda' | 'devolucao' | 'excluida' | 'pendente'; motivo: string;
}
const str = (o: unknown, p: string) => String(campo(o, p) ?? '').trim();
const numero = (o: unknown, p: string) => Number(str(o, p).replace(',', '.'));
const id = (o: unknown, p: string) => {
  const n = numero(o, p);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
// Lista conservadora. Outras vendas ficam pendentes de revisão, sem virar zero silencioso.
const CFOPS_VENDA = new Set(['5101','5102','5105','5106','6101','6102','6105','6106','7101','7102']);

export function paginaNotas(r: Obj) {
  // ClienteOmie converte a resposta explícita de listagem vazia em {}.
  if (Object.keys(r).length === 0) return { notas: [] as Obj[], paginas: 1, total: 0 };
  const notas = r.nfCadastro;
  const paginas = Number(r.total_de_paginas);
  const total = Number(r.total_de_registros);
  if (!Array.isArray(notas) || !Number.isInteger(paginas) || paginas < 0 ||
      !Number.isInteger(total) || total < 0 || (total > 0 && paginas < 1)) {
    throw new Error('Resposta fiscal incompleta: cobertura não confirmada');
  }
  return { notas: notas as Obj[], paginas: Math.max(paginas, 1), total };
}

export function mapearNota(n: Obj): LinhaNota[] {
  const nf_id = id(n, 'compl.nIdNF');
  const data = deOmie(str(n, 'ide.dEmi'));
  if (!nf_id || !data || !Number.isFinite(Date.parse(data)) || new Date(data).toISOString().slice(0,10) !== data) {
    throw new Error('NF sem identificação ou data válida');
  }
  if (!Array.isArray(n.det) || !n.det.length) throw new Error(`NF ${nf_id}: detalhes dos itens ausentes`);
  const chaves = new Set<string>();
  return n.det.map((d: Obj) => {
    // A posição é apenas uma chave dentro do snapshot completo e imutável da NF.
    const linha_id = String(id(d, 'nfProdInt.nCodItem') ?? `pos-${chaves.size + 1}`);
    if (chaves.has(linha_id)) throw new Error(`NF ${nf_id}: item duplicado`);
    chaves.add(linha_id);
    const quantidade = numero(d, 'prod.qCom');
    const valor = numero(d, 'prod.vProd') - numero(d, 'prod.vDesc');
    if (!str(d, 'prod.qCom') || !Number.isFinite(quantidade) || quantidade < 0 || !Number.isFinite(valor)) {
      throw new Error(`NF ${nf_id}: quantidade/valor inválido`);
    }
    const cfop = str(d, 'prod.CFOP').replace(/\D/g, '');
    const operacao = str(n, 'pedido.opPedido');
    let natureza: LinhaNota['natureza'] = 'pendente', motivo = 'Operação fiscal não classificada';
    if (str(n, 'ide.dCan') || str(n, 'ide.dInut') || str(n, 'ide.cDeneg') === 'S') {
      natureza = 'excluida'; motivo = 'Cancelada, inutilizada ou denegada';
    } else if (str(n, 'ide.tpAmb') !== '1') {
      natureza = 'excluida'; motivo = 'Ambiente diferente de produção ou não informado';
    } else if (operacao === '13' && str(n, 'ide.finNFe') === '4') {
      natureza = 'devolucao'; motivo = 'Devolução de venda, separada da venda bruta';
    } else if (['14','16','21','22','23','24','26','28','01'].includes(operacao)) {
      natureza = 'excluida'; motivo = 'Movimento diferente de venda de produto';
    } else if (['11','12'].includes(operacao) && str(n, 'ide.tpNF') === '1' && str(n, 'ide.finNFe') === '1') {
      if (str(d, 'prod.indTot') === '0') {
        natureza = 'excluida'; motivo = 'Item não compõe o total fiscal (conferir kit)';
      } else if (CFOPS_VENDA.has(cfop)) {
        natureza = 'venda'; motivo = 'Venda de produto; quantidade bruta';
      } else motivo = 'CFOP de venda requer revisão';
    }
    const unidade = str(d, 'prod.uCom').toUpperCase();
    if (natureza === 'venda' && (!unidade || !id(d, 'nfProdInt.nCodProd'))) {
      natureza = 'pendente'; motivo = 'Produto Omie ou unidade ausente';
    }
    return { nf_id, linha_id, produto_omie_id: id(d, 'nfProdInt.nCodProd'),
      codigo: str(d, 'prod.cProd'), descricao: str(d, 'prod.xProd'), unidade, data_emissao: data,
      pedido_omie_id: id(n, 'compl.nIdPedido'), cfop, operacao, quantidade, valor, natureza, motivo };
  });
}
