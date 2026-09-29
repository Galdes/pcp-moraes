import { DiagnosticoDemanda } from "@/components/DiagnosticoDemanda";
import { sql } from "@/lib/db";
import { Aviso, Cabecalho, Card, Vazio } from "@/components/ui";
import { exigir, ESCRITORIO } from "@/server/auth";
import { CONTRATOS, contratoLiberado, type NomeContrato } from "@/integrations/omie/contratos";
import { montarChamada } from "@/integrations/omie/sync";
import { lerConfigOmie } from "@/integrations/omie/config";
import { resumoParaMonday } from "@/integrations/monday/resumo";
import { fmtDataHora } from "@/lib/formato";
import { ativarOmieAction, conectarOmieAction, desativarOmieAction, desconectarOmieAction, modoOmieAction, outboxAction, sincronizarAction, testarOmieAction, validadosOmieAction } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Integrações" };

const ENTIDADES: [string, string, string][] = [
  ["produtos", "Produtos", "a cada 60 min"],
  ["estrutura", "Estruturas", "1 vez ao dia"],
  ["estoque", "Saldo de estoque", "a cada 10 min"],
  ["pedidos", "Pedidos de venda", "a cada 10 min"],
  ["compras", "Pedidos de compra", "a cada 30 min"],
  ["outbox", "Envios ao Omie (OP, requisição)", "a cada execução"],
];

export default async function Integracoes({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const usuario = await exigir(...ESCRITORIO);
  const admin = usuario.perfil === "admin";
  const sp = await searchParams;
  const cfg = await lerConfigOmie();
  const modo = cfg.modo;
  const credenciais = !!cfg.appKey;
  const estados = new Map((await sql`select * from integracao_estado`).map((e) => [e.entidade as string, e]));
  const api = estados.get("omie:api");
  const outbox = await sql`select * from outbox order by case status when 'erro' then 0 when 'pendente' then 1 else 2 end, id desc limit 40`;
  const previas = await Promise.all(outbox.filter((o) => o.status !== "enviado").slice(0, 10).map(async (o) => [o.id, await montarChamada(o as never)] as const));
  const prev = new Map(previas);
  const log = await sql`select * from integracao_log order by id desc limit 40`;
  const monday = await resumoParaMonday();
  const corModo = { ativo: "bg-emerald-100 text-emerald-800", simulacao: "bg-amber-100 text-amber-800", desligado: "bg-slate-200 text-slate-600" }[modo];

  return (
    <>
      <Cabecalho coord="Sistema" titulo="Integrações" sub="Omie é o dono de produtos, estruturas, estoque, pedidos e compras. O PCP lê de lá e devolve OPs e requisições de compra." />
      <Aviso busca={sp} />

      <Card titulo="Conexão com o Omie" className="mb-4" acoes={
        admin && credenciais && (
          <div className="flex gap-2">
            <form action={testarOmieAction}><button className="btn-sec btn-xs">Testar conexão</button></form>
            {cfg.origemModo !== "ambiente" && (modo === "ativo"
              ? <form action={desativarOmieAction}><button className="btn-perigo btn-xs">Desativar</button></form>
              : <form action={ativarOmieAction}><button className="btn-pri btn-xs">Ativar</button></form>)}
          </div>
        )
      }>
        {cfg.aviso && <p className="mb-3 rounded bg-atencao/10 px-3 py-2 text-sm text-atencao">{cfg.aviso}</p>}
        <div className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="coord mb-1">1 · Credenciais</div>
            {cfg.origemCredenciais === "ambiente" ? (
              <p className="text-sm">Definidas nas variáveis do servidor (App Key <b className="font-mono">••••{cfg.finalChave}</b>). Essas têm prioridade sobre a tela.</p>
            ) : credenciais ? (
              <div className="text-sm">
                <p>Conectado com a App Key <b className="font-mono">••••{cfg.finalChave}</b>{cfg.credenciaisSalvasEm && <> · salva em {fmtDataHora(cfg.credenciaisSalvasEm)}</>}.</p>
                {admin && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <details className="w-full">
                      <summary className="cursor-pointer text-xs text-apagado">trocar credenciais</summary>
                      <FormCredenciais />
                    </details>
                    <form action={desconectarOmieAction}><button className="btn-perigo btn-xs">Desconectar</button></form>
                  </div>
                )}
              </div>
            ) : admin ? (
              cfg.podeSalvar ? (
                <>
                  <p className="text-sm text-apagado">No Omie: menu do usuário → <b>Portal do Desenvolvedor</b> (developer.omie.com.br) → <b>Minhas aplicações</b> → copie a App Key e o App Secret da Moraes. O PCP testa no Omie antes de salvar e de ativar; as chaves ficam criptografadas e não aparecem de novo na tela.</p>
                  <FormCredenciais />
                </>
              ) : (
                <p className="text-sm text-alerta">O servidor não tem um segredo para criptografar as credenciais. Defina CHAVE_CONFIG (16+ caracteres) nas variáveis do servidor.</p>
              )
            ) : (
              <p className="text-sm text-apagado">Não configuradas. Peça a um administrador para conectar o Omie.</p>
            )}
          </div>
          <div>
            <div className="coord mb-1">2 · Modo</div>
            {cfg.origemModo === "ambiente" ? (
              <p className="text-sm">Fixado em <b>{modo}</b> pela variável OMIE_MODO do servidor.</p>
            ) : admin ? (
              <form action={modoOmieAction} className="space-y-1 text-sm">
                {([
                  ["desligado", "Desligado", "nada é lido nem enviado"],
                  ["simulacao", "Simulação", "OPs e requisições ficam na fila e você vê o JSON que seria enviado; nada vai ao Omie"],
                  ["ativo", "Ativo", "lê produtos, estruturas, estoque e pedidos e envia OPs/requisições liberadas"],
                ] as const).map(([v, r, d]) => (
                  <label key={v} className="flex items-start gap-2">
                    <input type="radio" name="modo" value={v} defaultChecked={modo === v} disabled={v === "ativo" && !credenciais} className="mt-1" />
                    <span><b>{r}</b> <span className="text-xs text-apagado">· {d}</span></span>
                  </label>
                ))}
                <button className="btn-pri btn-xs mt-2">Aplicar modo</button>
              </form>
            ) : (
              <p className="text-sm">Atual: <b>{modo}</b>.</p>
            )}
            <p className="mt-3 text-xs text-apagado">3 · Libere os métodos de escrita marcados “validar” no quadro “Métodos da API usados” só depois de testá-los no portal do Omie.</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card titulo={<>Omie <span className={`badge ml-2 ${corModo}`}>{modo}</span></>} corpo="p-0" acoes={
          modo === "ativo" && <form action={sincronizarAction}><button className="btn-pri btn-xs">Sincronizar tudo agora</button></form>
        }>
          <div className="grid gap-3 border-b border-linha px-4 py-3 text-sm sm:grid-cols-3">
            <div><div className="coord">Credenciais</div>{credenciais ? "configuradas" : <span className="text-alerta">não configuradas</span>}</div>
            <div><div className="coord">Chamadas hoje</div>{(api?.chamadas_dia as number) ?? 0}{Number(process.env.OMIE_LIMITE_DIARIO || 0) > 0 && ` de ${process.env.OMIE_LIMITE_DIARIO}`} · limite {process.env.OMIE_REQ_POR_MINUTO || 200}/min por método</div>
            <div><div className="coord">Disjuntor</div>{api?.bloqueado_ate && new Date(api.bloqueado_ate as Date) > new Date() ? <span className="text-alerta">pausado até {fmtDataHora(api.bloqueado_ate as Date)}</span> : "fechado (normal)"}</div>
          </div>
          {modo !== "ativo" && (
            <p className="border-b border-linha bg-atencao/5 px-4 py-2 text-xs">
              {modo === "simulacao" ? "Modo simulação: nada é chamado no Omie. Os envios ficam na fila e você pode conferir abaixo exatamente o que seria enviado." : "Integração desligada."} Para ativar, use o quadro “Conexão com o Omie” acima.
            </p>
          )}
          <table className="tbl">
            <thead><tr><th>Dado</th><th>Frequência</th><th>Última execução</th><th>Último sucesso</th><th>Mensagem</th><th></th></tr></thead>
            <tbody>
              {ENTIDADES.map(([k, rot, freq]) => {
                const e = estados.get(`omie:${k}`);
                return (
                  <tr key={k}>
                    <td className="font-medium">{rot}</td>
                    <td className="text-xs text-apagado">{freq}</td>
                    <td className="text-xs">{fmtDataHora(e?.ultima_execucao as Date)}</td>
                    <td className="text-xs">{fmtDataHora(e?.ultimo_sucesso as Date)}</td>
                    <td className="max-w-72 text-xs text-apagado">{(e?.mensagem as string) ?? "–"}</td>
                    <td>{modo === "ativo" && <form action={sincronizarAction}><input type="hidden" name="entidade" value={k} /><button className="btn-sec btn-xs">agora</button></form>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card titulo="Métodos da API usados" corpo="p-0">
          <table className="tbl">
            <tbody>
              {(Object.keys(CONTRATOS) as NomeContrato[]).map((k) => {
                const c = CONTRATOS[k];
                const lib = contratoLiberado(k, cfg.validados);
                return (
                  <tr key={k}>
                    <td><div className="font-mono text-xs">{c.call}</div><div className="text-[11px] text-apagado">{c.endpoint}</div></td>
                    <td className="text-xs">{c.escrita ? "escrita" : "leitura"}</td>
                    <td>{c.verificado ? <span className="badge bg-emerald-100 text-emerald-800">verificado</span> : lib ? <span className="badge bg-sky-100 text-sky-800">validado</span> : <span className="badge bg-amber-100 text-amber-800" title={c.fonte}>validar</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="border-t border-linha px-4 py-2 text-xs text-apagado">Métodos de escrita marcados “validar” só são chamados depois de testados no portal do Omie e liberados abaixo.</p>
          {admin && cfg.origemValidados !== "ambiente" && (
            <form action={validadosOmieAction} className="border-t border-linha px-4 py-3 text-xs">
              <div className="coord mb-1">Liberar métodos de escrita testados</div>
              {(Object.keys(CONTRATOS) as NomeContrato[]).filter((k) => CONTRATOS[k].escrita && !CONTRATOS[k].verificado).map((k) => (
                <label key={k} className="flex items-center gap-2 py-0.5">
                  <input type="checkbox" name="validado" value={CONTRATOS[k].call} defaultChecked={contratoLiberado(k, cfg.validados)} />
                  <span className="font-mono">{CONTRATOS[k].call}</span>
                </label>
              ))}
              <button className="btn-sec btn-xs mt-2">Salvar liberações</button>
            </form>
          )}
        </Card>
      </div>

      <DiagnosticoDemanda podeImportar={admin || usuario.perfil === "pcp"} />

      <Card titulo="Fila de envios ao Omie" className="mt-4" corpo="p-0">
        {outbox.length === 0 ? <Vazio>Nenhum envio.</Vazio> : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead><tr><th>Tipo</th><th>Referência</th><th>Status</th><th className="num">Tentativas</th><th>Último erro / prévia</th><th></th></tr></thead>
              <tbody>
                {outbox.map((o) => {
                  const p = prev.get(o.id as number);
                  return (
                    <tr key={o.id as number}>
                      <td className="text-xs font-medium">{(o.tipo as string).replace("_", " ")}</td>
                      <td className="font-mono text-xs">{o.referencia as string}</td>
                      <td><span className={`badge ${o.status === "enviado" ? "bg-emerald-100 text-emerald-800" : o.status === "erro" ? "bg-red-100 text-red-700" : o.status === "cancelado" ? "bg-slate-100 text-slate-500" : "bg-amber-100 text-amber-800"}`}>{o.status as string}</span></td>
                      <td className="num text-xs">{o.tentativas as number}</td>
                      <td className="max-w-md text-xs">
                        {o.ultimo_erro && <div className="text-atencao">{o.ultimo_erro as string}</div>}
                        {p && (
                          <details>
                            <summary className="cursor-pointer text-apagado">ver o que será enviado</summary>
                            <pre className="mt-1 max-h-48 overflow-auto rounded bg-carta p-2 text-[11px]">{"erro" in p ? p.erro : `${CONTRATOS[p.contrato].call}\n${JSON.stringify(p.param, null, 2)}`}</pre>
                          </details>
                        )}
                      </td>
                      <td className="whitespace-nowrap">
                        {o.status === "erro" && <form action={outboxAction} className="inline"><input type="hidden" name="id" value={o.id as number} /><input type="hidden" name="acao" value="reenviar" /><button className="btn-sec btn-xs mr-1">reenviar</button></form>}
                        {["pendente", "erro"].includes(o.status as string) && <form action={outboxAction} className="inline"><input type="hidden" name="id" value={o.id as number} /><input type="hidden" name="acao" value="cancelar" /><button className="btn-perigo btn-xs">cancelar</button></form>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card titulo="Exportação executiva (via N8N)">
          <p className="text-sm">O N8N lê <code className="rounded bg-carta px-1">GET /api/export/monday</code> com o cabeçalho <code className="rounded bg-carta px-1">Authorization: Bearer EXPORT_TOKEN</code> e atualiza um item por máquina no quadro do Monday.</p>
          <p className="mt-2 text-sm">Token {process.env.EXPORT_TOKEN && process.env.EXPORT_TOKEN.length >= 16 ? "configurado" : <span className="text-alerta">não configurado (mín. 16 caracteres)</span>}. Máquinas no resumo agora: {monday.maquinas.length}.</p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-apagado">prévia do JSON</summary>
            <pre className="mt-1 max-h-72 overflow-auto rounded bg-carta p-2 text-[11px]">{JSON.stringify({ ...monday, maquinas: monday.maquinas.slice(0, 3) }, null, 2)}</pre>
          </details>
        </Card>
        <Card titulo="Registro das integrações" corpo="p-0">
          {log.length === 0 ? <Vazio>Sem registros.</Vazio> : (
            <ul className="max-h-80 divide-y divide-linha overflow-auto text-xs">
              {log.map((l) => (
                <li key={l.id as number} className="flex gap-2 px-4 py-1.5">
                  <span className="w-24 shrink-0 text-apagado">{fmtDataHora(l.created_at as Date)}</span>
                  <span className={`w-14 shrink-0 font-semibold ${l.status === "erro" ? "text-alerta" : "text-ok"}`}>{l.status as string}</span>
                  <span className="w-24 shrink-0">{l.entidade as string}</span>
                  <span className="text-apagado">{l.mensagem as string}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function FormCredenciais() {
  return (
    <form action={conectarOmieAction} className="mt-2 grid gap-2 text-sm" autoComplete="off">
      <label className="grid gap-0.5">
        <span className="text-xs text-apagado">App Key</span>
        <input name="app_key" inputMode="numeric" autoComplete="off" spellCheck={false} required className="inp font-mono" placeholder="ex.: 1234567890123" />
      </label>
      <label className="grid gap-0.5">
        <span className="text-xs text-apagado">App Secret</span>
        <input name="app_secret" type="password" autoComplete="new-password" spellCheck={false} required className="inp font-mono" />
      </label>
      <div><button className="btn-pri btn-xs">Testar conexão</button> <span className="text-xs text-apagado">salva só se o Omie aceitar; depois clique em “Ativar”</span></div>
    </form>
  );
}
