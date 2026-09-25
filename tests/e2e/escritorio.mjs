// Fluxos de escritório pelas telas: MRP, gerar requisição, liberar OP, aprovar programa.
import { chromium } from "@playwright/test";
import postgres from "postgres";

const base = process.argv[2] ?? "http://localhost:3100";
const sql = postgres(process.env.DATABASE_URL);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const erros = [];
async function entrar(login) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  p.on("pageerror", (e) => erros.push(e.message));
  await p.goto(`${base}/login`);
  await p.fill("#login", login);
  await p.fill("#senha", "trocar123");
  await p.click("button:has-text('Entrar')");
  await p.waitForURL(base + "/");
  return p;
}
const msg = async (p) => (await p.locator("[role=status],[role=alert]").first().textContent().catch(() => "(sem mensagem)"))?.trim();

const pcp = await entrar("pcp");
await pcp.goto(`${base}/mrp`);
await pcp.click("text=Calcular MRP agora");
await pcp.waitForLoadState("networkidle");
console.log("MRP:", await msg(pcp));
await pcp.screenshot({ path: "/home/claude/shots/mrp_calculado.png", fullPage: true });
await pcp.click("text=Gerar requisição de compra");
await pcp.waitForLoadState("networkidle");
console.log("Requisição:", await msg(pcp));

const [op] = await sql`select id, numero from ordens_producao where status = 'firmada' and origem = 'pedido' order by data_necessidade limit 1`;
await pcp.goto(`${base}/ops/${op.id}`);
const temFalta = await pcp.locator("textarea[name=assumir_falta]").count();
if (temFalta) await pcp.fill("textarea[name=assumir_falta]", "Teste E2E: compras confirmou entrega");
await pcp.click("button:has-text('Liberar')");
await pcp.waitForLoadState("networkidle");
console.log(`Liberar OP ${op.numero}:`, await msg(pcp));

// pcp não pode aprovar programa
await pcp.goto(`${base}/programacao`);
console.log("PCP vê botão aprovar?", await pcp.locator("button:has-text('Aprovar programa')").count());

const dir = await entrar("fernando");
await dir.goto(`${base}/programacao`);
await dir.click("button:has-text('Aprovar programa')");
await dir.waitForLoadState("networkidle");
console.log("Aprovar:", await msg(dir));
await dir.screenshot({ path: "/home/claude/shots/programacao_aprovada.png" });

// OP manual inválida mostra erro amigável
await pcp.goto(`${base}/ops`);
await pcp.selectOption("select[name=item_id]", { index: 1 });
await pcp.fill("input[name=quantidade]", "abc");
await pcp.click("text=Criar OP firmada");
await pcp.waitForLoadState("networkidle");
console.log("OP inválida:", await msg(pcp));

console.log(erros.length ? "ERROS: " + erros.join(" | ") : "sem erros de página");
await browser.close();
await sql.end();
