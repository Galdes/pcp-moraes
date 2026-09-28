"use server";
import { exigir } from "@/server/auth";
import { executar, inteiro, texto } from "@/lib/acao";
import { sql } from "@/lib/db";
import { executarSincronizacao, testarConexao } from "@/integrations/omie/sync";
import { lerConfigOmie, removerCredenciais, salvarCredenciais, salvarModo, salvarValidados, MODOS, type ModoOmie } from "@/integrations/omie/config";
import { ErroDominio } from "@/domain/tipos";
import { reprogramar } from "@/server/programacao";
import { auditar } from "@/server/auditoria";

export async function sincronizarAction(f: FormData) {
  await exigir("admin", "pcp");
  await executar("/integracoes", async () => {
    const ent = texto(f, "entidade");
    const r = await executarSincronizacao({ forcar: ent ? [ent] : ["produtos", "estrutura", "estoque", "pedidos", "compras", "outbox"] });
    if (r.some((x) => x.ok)) await reprogramar();
    return r.map((x) => `${x.entidade}: ${x.ok ? "ok" : "erro"} (${x.mensagem})`).join(" · ");
  });
}

export async function outboxAction(f: FormData) {
  const u = await exigir("admin", "pcp");
  await executar("/integracoes", async () => {
    const id = inteiro(f, "id");
    const acao = texto(f, "acao");
    if (acao === "reenviar") await sql`update outbox set status = 'pendente', tentativas = 0, proxima_tentativa = now(), updated_at = now() where id = ${id}`;
    if (acao === "cancelar") await sql`update outbox set status = 'cancelado', updated_at = now() where id = ${id} and status <> 'enviado'`;
    await auditar(u.id, "outbox", id, acao);
    return acao === "reenviar" ? "Item volta para a fila" : "Envio cancelado";
  });
}

// ---------- conexão com o Omie (só administrador) ----------

/** Testa as credenciais no Omie e, se o Omie aceitar, salva criptografado. */
export async function conectarOmieAction(f: FormData) {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const cfg = await lerConfigOmie();
    if (cfg.origemCredenciais === "ambiente") throw new ErroDominio("As credenciais estão definidas nas variáveis do servidor e têm prioridade. Remova-as de lá para usar esta tela.");
    const appKey = texto(f, "app_key");
    const appSecret = texto(f, "app_secret");
    if (!appKey || !appSecret) throw new ErroDominio("Informe a App Key e o App Secret");
    if (!/^\d{6,20}$/.test(appKey)) throw new ErroDominio("A App Key do Omie tem só números. Confira se não colou o App Secret no lugar dela.");
    if (appSecret.length < 16) throw new ErroDominio("O App Secret parece incompleto. Copie de novo do Portal do Desenvolvedor do Omie.");
    const teste = await testarConexao(appKey, appSecret);
    await auditar(u.id, "integracao", "omie", teste.ok ? "credenciais_testadas_ok" : "credenciais_recusadas", { final_chave: appKey.slice(-4) });
    if (!teste.ok) throw new ErroDominio(`${teste.mensagem.replace(/\.+$/, "")}. Nada foi salvo.`);
    await salvarCredenciais(appKey, appSecret, u.id);
    await auditar(u.id, "integracao", "omie", "credenciais_salvas", { final_chave: appKey.slice(-4) });
    return `${teste.mensagem}. Credenciais salvas (criptografadas). Agora clique em "Ativar", ou use "Simulação" para conferir antes.`;
  });
}

export async function testarOmieAction() {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const cfg = await lerConfigOmie();
    if (!cfg.appKey) throw new ErroDominio("Não há credenciais configuradas");
    const teste = await testarConexao(cfg.appKey, cfg.appSecret);
    await auditar(u.id, "integracao", "omie", teste.ok ? "teste_ok" : "teste_falhou");
    if (!teste.ok) throw new ErroDominio(teste.mensagem);
    return teste.mensagem;
  });
}

/** Liga a integração: testa de novo as credenciais salvas e só ativa se o Omie responder certo. */
export async function ativarOmieAction() {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const cfg = await lerConfigOmie();
    if (cfg.origemModo === "ambiente") throw new ErroDominio("O modo está fixado pela variável OMIE_MODO no servidor. Remova-a de lá para ativar por aqui.");
    if (!cfg.appKey) throw new ErroDominio("Conecte o Omie (App Key e App Secret) antes de ativar");
    const teste = await testarConexao(cfg.appKey, cfg.appSecret);
    if (!teste.ok) {
      await auditar(u.id, "integracao", "omie", "ativacao_recusada");
      throw new ErroDominio(`${teste.mensagem.replace(/\.+$/, "")}. A integração NÃO foi ativada.`);
    }
    await salvarModo("ativo", u.id);
    await auditar(u.id, "integracao", "omie", "modo", { de: cfg.modo, para: "ativo" });
    return `${teste.mensagem}. Integração ATIVA: o PCP passa a ler e enviar dados ao Omie`;
  });
}

export async function desativarOmieAction() {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const cfg = await lerConfigOmie();
    if (cfg.origemModo === "ambiente") throw new ErroDominio("O modo está fixado pela variável OMIE_MODO no servidor.");
    await salvarModo("desligado", u.id);
    await auditar(u.id, "integracao", "omie", "modo", { de: cfg.modo, para: "desligado" });
    return "Integração desligada";
  });
}

export async function desconectarOmieAction() {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    await removerCredenciais();
    await salvarModo("desligado", u.id);
    await auditar(u.id, "integracao", "omie", "credenciais_removidas");
    return "Credenciais removidas e integração desligada";
  });
}

export async function modoOmieAction(f: FormData) {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const modo = texto(f, "modo") as ModoOmie;
    if (!MODOS.includes(modo)) throw new ErroDominio("Modo inválido");
    const cfg = await lerConfigOmie();
    if (cfg.origemModo === "ambiente") throw new ErroDominio("O modo está fixado pela variável OMIE_MODO no servidor. Remova-a de lá para escolher aqui.");
    if (modo === "ativo" && !cfg.appKey) throw new ErroDominio("Conecte o Omie (App Key e App Secret) antes de ativar");
    if (modo === "ativo") {
      const teste = await testarConexao(cfg.appKey, cfg.appSecret);
      if (!teste.ok) throw new ErroDominio(`${teste.mensagem.replace(/\.+$/, "")}. A integração NÃO foi ativada.`);
    }
    await salvarModo(modo, u.id);
    await auditar(u.id, "integracao", "omie", "modo", { de: cfg.modo, para: modo });
    return { ativo: "Integração ATIVA: o PCP passa a ler e enviar dados ao Omie", simulacao: "Modo simulação: nada é enviado ao Omie", desligado: "Integração desligada" }[modo];
  });
}

export async function validadosOmieAction(f: FormData) {
  const u = await exigir("admin");
  await executar("/integracoes", async () => {
    const cfg = await lerConfigOmie();
    if (cfg.origemValidados === "ambiente") throw new ErroDominio("Os métodos validados estão fixados pela variável OMIE_CONTRATOS_VALIDADOS no servidor.");
    const calls = f.getAll("validado").map(String);
    await salvarValidados(calls, u.id);
    await auditar(u.id, "integracao", "omie", "contratos_validados", { calls });
    return calls.length ? `Liberados para envio: ${calls.join(", ")}` : "Nenhum método de escrita pendente liberado";
  });
}
