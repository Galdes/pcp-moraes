/** Meses civis consecutivos; o mês corrente é parcial. */
export function mesesDemanda(hoje: string, quantidade = 24): string[] {
  const [a, m] = hoje.split('-').map(Number);
  return Array.from({ length: quantidade }, (_, i) =>
    new Date(Date.UTC(a, m - quantidade + i, 1)).toISOString().slice(0, 10));
}

export function fimMes(mes: string): string {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export interface PontoDemanda {
  mes: string;
  quantidade: number | null;
  media: number | null;
  parcial: boolean;
}

/** Só um mês integralmente importado permite inferir zero. Não interpola lacunas. */
export function serieDemanda(hoje: string, totais: Map<string, number>, cobertura: Map<string, string>): PontoDemanda[] {
  const serie = mesesDemanda(hoje).map(mes => {
    const parcial = mes.slice(0, 7) === hoje.slice(0, 7);
    const ate = cobertura.get(mes);
    const completo = ate !== undefined && ate >= (parcial ? hoje : fimMes(mes));
    return { mes, quantidade: completo ? (totais.get(mes) ?? 0) : null, media: null, parcial } as PontoDemanda;
  });
  for (let i = 2; i < serie.length; i++) {
    const janela = serie.slice(i - 2, i + 1);
    if (janela.every(p => p.quantidade !== null && !p.parcial)) {
      serie[i].media = janela.reduce((s, p) => s + p.quantidade!, 0) / 3;
    }
  }
  return serie;
}

/** O modelo operacional atual é por produto: agrega linhas repetidas em vez de sobrescrever. */
export function agregarItensPedido(itens: { produto_omie_id: number; quantidade: number }[]) {
  const porProduto = new Map<number, number>();
  for (const i of itens) {
    if (!Number.isSafeInteger(i.produto_omie_id) || i.produto_omie_id <= 0 || !Number.isFinite(i.quantidade) || i.quantidade <= 0) {
      throw new Error('Item de pedido inválido');
    }
    porProduto.set(i.produto_omie_id, (porProduto.get(i.produto_omie_id) ?? 0) + i.quantidade);
  }
  return [...porProduto].map(([produto_omie_id, quantidade]) => ({ produto_omie_id, quantidade }));
}
