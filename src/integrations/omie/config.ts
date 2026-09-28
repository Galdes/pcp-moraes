// Configuração da integração com o Omie.
//
// Pode vir de dois lugares:
//  1. variáveis de ambiente do servidor (OMIE_APP_KEY, OMIE_APP_SECRET,
//     OMIE_MODO, OMIE_CONTRATOS_VALIDADOS) — têm prioridade e não são
//     editáveis pela tela;
//  2. tela Integrações do próprio PCP (só administrador) — gravada na tabela
//     `configuracoes`, com App Key e App Secret criptografados (AES-256-GCM).
//
// A chave de criptografia vem de CHAVE_CONFIG; na falta dela, de EXPORT_TOKEN
// ou CRON_SECRET. Se essa variável mudar, as credenciais salvas ficam
// ilegíveis e a tela pede para colar de novo (nada quebra além disso).

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { CONTRATOS, type Contrato } from "./contratos";

export type ModoOmie = "desligado" | "simulacao" | "ativo";
export const MODOS: ModoOmie[] = ["desligado", "simulacao", "ativo"];

export type Origem = "ambiente" | "sistema" | null;

export interface ConfigOmie {
  appKey: string;
  appSecret: string;
  modo: ModoOmie;
  /** lista de métodos de escrita validados, separados por vírgula */
  validados: string;
  origemCredenciais: Origem;
  origemModo: "ambiente" | "sistema" | "padrao";
  origemValidados: "ambiente" | "sistema" | "padrao";
  /** últimos 4 caracteres da App Key, para conferência na tela */
  finalChave: string | null;
  credenciaisSalvasEm: Date | null;
  /** preenchido quando existem credenciais salvas que não puderam ser lidas */
  aviso: string | null;
  /** false quando não há segredo no servidor para criptografar */
  podeSalvar: boolean;
}

const C_KEY = "omie.app_key";
const C_SECRET = "omie.app_secret";
const C_MODO = "omie.modo";
const C_VALIDADOS = "omie.contratos_validados";

let tabelaPronta = false;
async function garantirTabela() {
  if (tabelaPronta) return;
  await sql`create table if not exists configuracoes (
    chave          text primary key,
    valor          text not null,
    atualizado_por int references usuarios(id),
    updated_at     timestamptz not null default now()
  )`;
  tabelaPronta = true;
}

function segredoServidor(): string | null {
  const s = process.env.CHAVE_CONFIG || process.env.EXPORT_TOKEN || process.env.CRON_SECRET || "";
  return s.length >= 16 ? s : null;
}

function chaveCripto(): Buffer {
  const s = segredoServidor();
  if (!s) throw new Error("Defina CHAVE_CONFIG (ou EXPORT_TOKEN/CRON_SECRET) com 16+ caracteres no servidor para salvar credenciais");
  return createHash("sha256").update("pcp-moraes:config:" + s).digest();
}

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chaveCripto(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), dados.toString("base64")].join(":");
}

export function decifrar(valor: string): string {
  const [v, iv, tag, dados] = valor.split(":");
  if (v !== "v1" || !iv || !tag || !dados) throw new Error("formato inválido");
  const d = createDecipheriv("aes-256-gcm", chaveCripto(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(dados, "base64")), d.final()]).toString("utf8");
}

async function lerTudo(): Promise<Map<string, { valor: string; updated_at: Date }>> {
  await garantirTabela();
  const linhas = await sql`select chave, valor, updated_at from configuracoes where chave like 'omie.%'`;
  return new Map(linhas.map((l) => [l.chave as string, { valor: l.valor as string, updated_at: l.updated_at as Date }]));
}

export async function lerConfigOmie(): Promise<ConfigOmie> {
  const env = process.env;
  const salvo = await lerTudo();
  let aviso: string | null = null;

  let appKey = "",
    appSecret = "",
    origemCredenciais: Origem = null,
    credenciaisSalvasEm: Date | null = null;
  if (env.OMIE_APP_KEY && env.OMIE_APP_SECRET) {
    appKey = env.OMIE_APP_KEY;
    appSecret = env.OMIE_APP_SECRET;
    origemCredenciais = "ambiente";
  } else if (salvo.has(C_KEY) && salvo.has(C_SECRET)) {
    try {
      appKey = decifrar(salvo.get(C_KEY)!.valor);
      appSecret = decifrar(salvo.get(C_SECRET)!.valor);
      origemCredenciais = "sistema";
      credenciaisSalvasEm = salvo.get(C_KEY)!.updated_at;
    } catch {
      aviso = "As credenciais salvas não puderam ser lidas (o segredo do servidor mudou). Cole a App Key e o App Secret de novo.";
    }
  }

  // OMIE_MODO=desligado (valor padrão do .env.example) não trava a tela: só
  // "simulacao" ou "ativo" definidos no servidor têm prioridade.
  const modoEnv = env.OMIE_MODO === "simulacao" || env.OMIE_MODO === "ativo" ? (env.OMIE_MODO as ModoOmie) : undefined;
  const modoSalvo = salvo.get(C_MODO)?.valor as ModoOmie | undefined;
  const modo: ModoOmie = modoEnv && MODOS.includes(modoEnv) ? modoEnv : modoSalvo && MODOS.includes(modoSalvo) ? modoSalvo : "desligado";
  const origemModo = modoEnv && MODOS.includes(modoEnv) ? "ambiente" : modoSalvo ? "sistema" : "padrao";

  const valEnv = (env.OMIE_CONTRATOS_VALIDADOS ?? "").trim();
  const valSalvo = salvo.get(C_VALIDADOS)?.valor ?? "";
  const validados = valEnv || valSalvo;
  const origemValidados = valEnv ? "ambiente" : salvo.has(C_VALIDADOS) ? "sistema" : "padrao";

  return {
    appKey,
    appSecret,
    modo,
    validados,
    origemCredenciais,
    origemModo,
    origemValidados,
    finalChave: appKey ? appKey.slice(-4) : null,
    credenciaisSalvasEm,
    aviso,
    podeSalvar: !!segredoServidor(),
  };
}

async function gravar(chave: string, valor: string, usuarioId: number | null) {
  await garantirTabela();
  await sql`insert into configuracoes (chave, valor, atualizado_por, updated_at) values (${chave}, ${valor}, ${usuarioId}, now())
            on conflict (chave) do update set valor = excluded.valor, atualizado_por = excluded.atualizado_por, updated_at = now()`;
}

export async function salvarCredenciais(appKey: string, appSecret: string, usuarioId: number | null) {
  const k = cifrar(appKey);
  const s = cifrar(appSecret);
  await gravar(C_KEY, k, usuarioId);
  await gravar(C_SECRET, s, usuarioId);
}

export async function removerCredenciais() {
  await garantirTabela();
  await sql`delete from configuracoes where chave in (${C_KEY}, ${C_SECRET})`;
}

export async function salvarModo(modo: ModoOmie, usuarioId: number | null) {
  if (!MODOS.includes(modo)) throw new Error(`Modo inválido: ${modo}`);
  await gravar(C_MODO, modo, usuarioId);
}

/** Métodos de escrita que precisam de validação manual antes de serem liberados. */
export function contratosAValidar(): Contrato[] {
  return Object.values(CONTRATOS).filter((c: Contrato) => c.escrita && !c.verificado);
}

export async function salvarValidados(calls: string[], usuarioId: number | null) {
  const permitidos = new Set(contratosAValidar().map((c) => c.call));
  const limpos = calls.filter((c) => permitidos.has(c));
  await gravar(C_VALIDADOS, limpos.join(","), usuarioId);
}
