// Checagens de qualidade dos dados de engenharia: o risco nº 2 de todo PCP
// é estrutura/roteiro errado. Esta tela mostra o que precisa ser corrigido
// antes de confiar no MRP e na programação.

import { sql } from "@/lib/db";
import { encontrarCiclos } from "@/domain/estrutura";
import { carregarEstrutura } from "./engenharia";

export async function checagens() {
  const semRoteiro = await sql`
    select i.id, i.codigo, i.descricao, i.tipo from itens i
    where i.ativo and i.origem = 'fabricado' and not exists (select 1 from roteiros r where r.item_id = i.id)
    order by i.codigo`;
  const semEstrutura = await sql`
    select i.id, i.codigo, i.descricao, i.tipo from itens i
    where i.ativo and i.origem = 'fabricado' and i.tipo in ('produto', 'conjunto')
      and not exists (select 1 from estrutura e where e.pai_id = i.id)
    order by i.codigo`;
  const semLeadTime = await sql`
    select i.id, i.codigo, i.descricao from itens i
    where i.ativo and i.origem = 'comprado' and i.lead_time_dias = 0 order by i.codigo`;
  const semOmie = await sql`
    select i.id, i.codigo, i.descricao, i.tipo from itens i
    where i.ativo and i.omie_id is null and (i.tipo = 'produto' or i.origem = 'comprado') order by i.codigo`;
  const revisar = await sql`select id, codigo, descricao, tipo, origem, politica from itens where ativo and revisar order by codigo`;
  const supermercadoSemLimites = await sql`
    select id, codigo, descricao from itens where ativo and politica = 'supermercado' and estoque_max <= 0 order by codigo`;
  const estruturaManual = await sql`
    select p.codigo as pai, f.codigo as filho from estrutura e join itens p on p.id = e.pai_id join itens f on f.id = e.filho_id
    where e.fonte = 'manual' and p.omie_id is not null order by p.codigo`;
  const est = await carregarEstrutura(sql);
  const codigos = new Map((await sql`select id, codigo from itens`).map((r) => [r.id as number, r.codigo as string]));
  const ciclos = encontrarCiclos(est).map((c) => c.map((i) => codigos.get(i) ?? String(i)).join(" → "));
  return { semRoteiro, semEstrutura, semLeadTime, semOmie, revisar, supermercadoSemLimites, estruturaManual, ciclos };
}
