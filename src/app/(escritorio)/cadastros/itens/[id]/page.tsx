import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, Vazio } from "@/components/ui";
import { CamposItem } from "@/components/CamposItem";
import { exigir, ESCRITORIO } from "@/server/auth";
import { fmtDataHora, fmtMin, fmtQtd, TIPO_ITEM } from "@/lib/formato";
import { addComponenteAction, removerComponenteAction, removerOperacaoAction, saldoManualAction, salvarItemAction, salvarOperacaoAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Item({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  await exigir(...ESCRITORIO);
  const { id } = await params;
  const sp = await searchParams;
  const [i] = await sql`select i.*, s.quantidade as saldo, s.fonte as saldo_fonte, s.atualizado_em from itens i left join estoque_saldos s on s.item_id = i.id where i.id = ${Number(id) || 0}`;
  if (!i) notFound();
  const comps = await sql`select e.*, f.codigo, f.descricao, f.unidade, f.tipo, f.origem, f.politica from estrutura e join itens f on f.id = e.filho_id where e.pai_id = ${i.id} order by f.tipo, f.codigo`;
  const usadoEm = await sql`select p.id, p.codigo, p.descricao, e.quantidade from estrutura e join itens p on p.id = e.pai_id where e.filho_id = ${i.id} order by p.codigo`;
  const ops = await sql`select r.*, s.nome as setor from roteiros r join setores s on s.id = r.setor_id where r.item_id = ${i.id} order by r.sequencia`;
  const setores = await sql`select id, nome from setores where ativo order by sequencia`;
  const todos = await sql`select codigo, descricao from itens where ativo and id <> ${i.id} order by codigo`;
  const fabricado = i.origem === "fabricado";
  const proxSeq = ((ops.at(-1)?.sequencia as number) ?? 0) + 10;

  return (
    <>
      <Cabecalho coord={`${TIPO_ITEM[i.tipo as string]} · ${i.origem}${fabricado ? ` · ${i.politica === "supermercado" ? "supermercado" : "sob pedido"}` : ""}`} titulo={i.codigo as string} sub={i.descricao as string} acoes={<Link href="/cadastros/itens" className="btn-sec">Voltar</Link>} />
      <Aviso busca={sp} />
      {i.revisar && <div className="mb-4 rounded-md border border-atencao/40 bg-atencao/5 px-4 py-2 text-sm">Item importado do Omie: confira tipo, origem e política e salve para tirar a marcação.</div>}

      <Card titulo="Cadastro">
        <form action={salvarItemAction} className="space-y-3">
          <input type="hidden" name="id" value={i.id as number} />
          <CamposItem i={i as never} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ativo" defaultChecked={i.ativo as boolean} /> Ativo</label>
          <button className="btn-pri">Salvar</button>
        </form>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card titulo={<span id="estrutura">Estrutura (componentes diretos)</span>} corpo="p-0">
          {comps.length === 0 ? <Vazio>{fabricado ? "Sem componentes." : "Item comprado: não tem estrutura."}</Vazio> : (
            <table className="tbl">
              <thead><tr><th>Componente</th><th>Tipo</th><th className="num">Qtd</th><th className="num">Perda</th><th>Fonte</th><th></th></tr></thead>
              <tbody>
                {comps.map((c) => (
                  <tr key={c.filho_id as number}>
                    <td><Link href={`/cadastros/itens/${c.filho_id}`} className="font-mono text-xs hover:underline">{c.codigo as string}</Link><div className="text-xs text-apagado">{c.descricao as string}</div></td>
                    <td className="text-xs">{TIPO_ITEM[c.tipo as string]}{c.politica === "supermercado" && c.origem === "fabricado" ? " · super" : ""}</td>
                    <td className="num">{fmtQtd(c.quantidade as number)} {c.unidade as string}</td>
                    <td className="num text-xs">{Number(c.perda_pct) ? `${fmtQtd(c.perda_pct as number)}%` : "–"}</td>
                    <td className="text-xs">{c.fonte as string}</td>
                    <td>{c.fonte === "manual" && (
                      <form action={removerComponenteAction}><input type="hidden" name="pai_id" value={i.id as number} /><input type="hidden" name="filho_id" value={c.filho_id as number} /><button className="btn-perigo btn-xs">remover</button></form>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {fabricado && (
            <form action={addComponenteAction} className="grid grid-cols-[1fr_90px_80px_auto] items-end gap-2 border-t border-linha p-3">
              <input type="hidden" name="pai_id" value={i.id as number} />
              <div><label className="lbl">Componente</label><input name="filho_codigo" list="lista-itens" className="inp font-mono" placeholder="código" required /></div>
              <div><label className="lbl">Qtd</label><input name="quantidade" className="inp" required /></div>
              <div><label className="lbl">Perda %</label><input name="perda_pct" className="inp" defaultValue="0" /></div>
              <button className="btn-sec">Incluir</button>
              <datalist id="lista-itens">{todos.map((t) => <option key={t.codigo as string} value={t.codigo as string}>{t.descricao as string}</option>)}</datalist>
            </form>
          )}
          <p className="border-t border-linha px-4 py-2 text-xs text-apagado">Linhas com fonte “omie” são mantidas pelo Omie (dono da estrutura) e atualizadas na sincronização.</p>
        </Card>

        <Card titulo={<span id="roteiro">Roteiro de fabricação</span>} corpo="p-0">
          {!fabricado ? <Vazio>Item comprado: não tem roteiro.</Vazio> : (
            <>
              {ops.length === 0 && <Vazio>Sem roteiro: este item não gera etapas nas OPs nem entra na programação.</Vazio>}
              {ops.map((o) => (
                <form key={o.id as number} action={salvarOperacaoAction} className="grid grid-cols-[56px_1fr_1.4fr_72px_72px_auto] items-end gap-2 border-b border-linha px-3 py-2">
                  <input type="hidden" name="item_id" value={i.id as number} />
                  <input type="hidden" name="id" value={o.id as number} />
                  <div><label className="lbl">Seq</label><input name="sequencia" defaultValue={o.sequencia as number} className="inp" /></div>
                  <div><label className="lbl">Setor</label><select name="setor_id" defaultValue={o.setor_id as number} className="inp">{setores.map((s) => <option key={s.id as number} value={s.id as number}>{s.nome as string}</option>)}</select></div>
                  <div><label className="lbl">Operação</label><input name="descricao" defaultValue={o.descricao as string} className="inp" /></div>
                  <div><label className="lbl">Setup min</label><input name="setup_min" defaultValue={o.setup_min as number} className="inp" /></div>
                  <div><label className="lbl">Min/un</label><input name="tempo_unit_min" defaultValue={o.tempo_unit_min as number} className="inp" /></div>
                  <div className="flex gap-1"><button className="btn-sec btn-xs">salvar</button><button formAction={removerOperacaoAction} className="btn-perigo btn-xs">x</button></div>
                </form>
              ))}
              <form action={salvarOperacaoAction} className="grid grid-cols-[56px_1fr_1.4fr_72px_72px_auto] items-end gap-2 bg-carta/40 px-3 py-2">
                <input type="hidden" name="item_id" value={i.id as number} />
                <div><label className="lbl">Seq</label><input name="sequencia" defaultValue={proxSeq} className="inp" /></div>
                <div><label className="lbl">Setor</label><select name="setor_id" className="inp">{setores.map((s) => <option key={s.id as number} value={s.id as number}>{s.nome as string}</option>)}</select></div>
                <div><label className="lbl">Nova operação</label><input name="descricao" className="inp" placeholder="ex.: Soldar conjunto" /></div>
                <div><label className="lbl">Setup min</label><input name="setup_min" defaultValue="0" className="inp" /></div>
                <div><label className="lbl">Min/un</label><input name="tempo_unit_min" defaultValue="0" className="inp" /></div>
                <button className="btn-pri btn-xs">incluir</button>
              </form>
              <p className="px-4 py-2 text-xs text-apagado">
                Tempo total por unidade: {fmtMin(ops.reduce((a, o) => a + Number(o.tempo_unit_min), 0))} + setup {fmtMin(ops.reduce((a, o) => a + Number(o.setup_min), 0))}. Os tempos reais apontados aparecem no painel de OEE: use-os para calibrar este roteiro.
              </p>
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card titulo="Onde é usado" corpo="p-0">
          {usadoEm.length === 0 ? <Vazio>Não é componente de nenhum item.</Vazio> : (
            <table className="tbl"><tbody>
              {usadoEm.map((u) => (
                <tr key={u.id as number}><td><Link href={`/cadastros/itens/${u.id}`} className="font-mono text-xs hover:underline">{u.codigo as string}</Link> <span className="text-xs text-apagado">{u.descricao as string}</span></td><td className="num">{fmtQtd(u.quantidade as number)}</td></tr>
              ))}
            </tbody></table>
          )}
        </Card>
        <Card titulo="Saldo em estoque">
          <p className="text-sm">
            <span className="text-2xl font-semibold tabular-nums">{i.saldo === null ? "–" : fmtQtd(i.saldo as number)}</span> {i.unidade as string}
            <span className="ml-2 text-xs text-apagado">{i.saldo_fonte ? `fonte: ${i.saldo_fonte} · ${fmtDataHora(i.atualizado_em as Date)}` : "sem saldo registrado"}</span>
          </p>
          {i.saldo_fonte !== "omie" && (
            <form action={saldoManualAction} className="mt-3 flex gap-2">
              <input type="hidden" name="item_id" value={i.id as number} />
              <input name="quantidade" className="inp w-40" placeholder="novo saldo" required />
              <button className="btn-sec">Ajustar (manual)</button>
            </form>
          )}
        </Card>
      </div>
    </>
  );
}
