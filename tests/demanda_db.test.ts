import { beforeAll, describe, expect, it } from 'vitest';
import { migrar } from '../scripts/migrate';
import { sql } from '@/lib/db';
import { importarPaginaDemanda, lerDemanda, recortarDemanda } from '@/server/demanda';
import type { ClienteOmie } from '@/integrations/omie/cliente';

const url = process.env.DATABASE_URL_TEST ?? 'postgres://pcp:pcp@localhost:5432/pcp_test';
process.env.DATABASE_URL = url;
process.env.OMIE_MODO = 'ativo';
process.env.OMIE_APP_KEY = 'teste-demanda';
process.env.OMIE_APP_SECRET = 'somente-teste';

beforeAll(async () => {
  await migrar(url, true);
  await sql`insert into itens(codigo,descricao,unidade,tipo,origem,omie_id,familia_demanda)
    values ('QA-PECA','Peça de teste','UN','peca','fabricado',99,'Peças de teste')`;
}, 60000);

describe('publicação atômica do histórico fiscal', () => {
  it('retoma páginas, preserva snapshots completos, reimporta sem duplicar e separa empresas', async () => {
    const hoje = '2026-09-29';
    const nota = (n: number, qtd = 5) => ({
      compl:{nIdNF:n}, ide:{dEmi:'15/10/2024',tpNF:'1',tpAmb:'1',finNFe:'1'},pedido:{opPedido:'11'},
      det:[{nfProdInt:{nCodProd:99,nCodItem:1},prod:{cProd:'QA-PECA',xProd:'Peça de teste',uCom:'UN',qCom:qtd,vProd:50,CFOP:'5101',indTot:1}}],
    });
    let falhar = false;
    const cliente = { chamar: async (_c: unknown,p: Record<string,unknown>) => {
      if (falhar) throw new Error('rede indisponível');
      return {nfCadastro:[nota(Number(p.pagina))],total_de_paginas:2,total_de_registros:2};
    } } as unknown as ClienteOmie;
    await importarPaginaDemanda({cliente,hoje});
    let dados = await lerDemanda();
    expect(dados.disponivel && dados.lotes).toHaveLength(0);
    falhar = true;
    await expect(importarPaginaDemanda({cliente,hoje})).rejects.toThrow('rede indisponível');
    expect((await sql`select proxima_pagina from demanda_lotes`)[0].proxima_pagina).toBe(2);
    falhar = false;
    await importarPaginaDemanda({cliente,hoje});
    dados = await lerDemanda();
    if (!dados.disponivel) throw new Error('esquema ausente');
    expect(dados.lotes).toHaveLength(1);
    expect(recortarDemanda(dados,'item:99').serie[0].quantidade).toBe(10);
    await sql`update demanda_lotes set concluido_em=now()-interval '2 days'`;
    await importarPaginaDemanda({cliente,hoje});
    dados = await lerDemanda();
    expect(dados.disponivel && dados.linhas).toHaveLength(2); // ainda o snapshot anterior
    await importarPaginaDemanda({cliente,hoje});
    dados = await lerDemanda();
    if (!dados.disponivel) throw new Error('esquema ausente');
    expect(dados.lotes).toHaveLength(1);
    expect(recortarDemanda(dados,'item:99').serie[0].quantidade).toBe(10); // nunca 20
    await sql`update itens set revisar=true where omie_id=99`;
    dados = await lerDemanda();
    if (!dados.disponivel) throw new Error('esquema ausente');
    expect(recortarDemanda(dados,'familia:Peças de teste').serie[0].quantidade).toBeNull();
    process.env.OMIE_APP_KEY='outra-empresa';
    dados = await lerDemanda();
    expect(dados.disponivel && dados.lotes).toHaveLength(0);
    process.env.OMIE_APP_KEY='teste-demanda';
    const contagens = await sql`select (select count(*)::int from ordens_producao) as ops, (select count(*)::int from outbox) as envios`;
    expect(contagens[0]).toMatchObject({ops:0,envios:0});
  });
});
