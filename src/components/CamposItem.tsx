import { TIPO_ITEM } from "@/lib/formato";

type Item = Partial<Record<"codigo" | "descricao" | "unidade" | "tipo" | "origem" | "politica" | "lead_time_dias" | "estoque_seguranca" | "estoque_min" | "estoque_max" | "lote_minimo" | "lote_multiplo", string | number>>;

export function CamposItem({ i = {}, comCodigo = false }: { i?: Item; comCodigo?: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {comCodigo && <div><label className="lbl">Código</label><input name="codigo" className="inp font-mono" required /></div>}
      <div className={comCodigo ? "lg:col-span-2" : "sm:col-span-2 lg:col-span-3"}><label className="lbl">Descrição</label><input name="descricao" defaultValue={i.descricao} className="inp" required /></div>
      <div><label className="lbl">Unidade</label><input name="unidade" defaultValue={i.unidade ?? "UN"} className="inp" /></div>
      <div>
        <label className="lbl">Tipo</label>
        <select name="tipo" defaultValue={String(i.tipo ?? "peca")} className="inp">
          {Object.entries(TIPO_ITEM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <div>
        <label className="lbl">Origem</label>
        <select name="origem" defaultValue={String(i.origem ?? "fabricado")} className="inp">
          <option value="fabricado">Fabricado</option>
          <option value="comprado">Comprado</option>
        </select>
      </div>
      <div>
        <label className="lbl">Política (fabricados)</label>
        <select name="politica" defaultValue={String(i.politica ?? "sob_pedido")} className="inp">
          <option value="sob_pedido">Sob pedido (fabrica dentro da OP)</option>
          <option value="supermercado">Supermercado (repõe por mín/máx)</option>
        </select>
      </div>
      <div><label className="lbl">Lead time (dias)</label><input name="lead_time_dias" type="number" min={0} defaultValue={i.lead_time_dias ?? 0} className="inp" /></div>
      <div><label className="lbl">Estoque de segurança</label><input name="estoque_seguranca" defaultValue={i.estoque_seguranca ?? 0} className="inp" /></div>
      <div><label className="lbl">Supermercado: mínimo</label><input name="estoque_min" defaultValue={i.estoque_min ?? 0} className="inp" /></div>
      <div><label className="lbl">Supermercado: máximo</label><input name="estoque_max" defaultValue={i.estoque_max ?? 0} className="inp" /></div>
      <div><label className="lbl">Lote mínimo</label><input name="lote_minimo" defaultValue={i.lote_minimo ?? 0} className="inp" /></div>
      <div><label className="lbl">Lote múltiplo</label><input name="lote_multiplo" defaultValue={i.lote_multiplo ?? 0} className="inp" /></div>
    </div>
  );
}
