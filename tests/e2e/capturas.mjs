// Uso: node tests/e2e/capturas.mjs <baseURL> <pastaSaida> <rota> [rota...]
// Faz login como admin (escritório) e 1003 (posto) e captura as telas.
import { chromium } from "@playwright/test";
import fs from "node:fs";

const [base, saida, ...rotas] = process.argv.slice(2);
fs.mkdirSync(saida, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
const erros = [];
async function sessao(tipo) {
  const ctx = await browser.newContext({ viewport: tipo === "posto" ? { width: 1180, height: 820 } : { width: 1440, height: 900 }, locale: "pt-BR" });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => erros.push(`${p.url()}: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && erros.push(`${p.url()}: console ${m.text()}`));
  await p.goto(`${base}/login`);
  if (tipo === "posto") {
    await p.fill("#matricula", "1003");
    await p.fill("#pin", "1234");
    await p.click("text=Entrar no posto");
  } else {
    await p.fill("#login", "admin");
    await p.fill("#senha", "trocar123");
    await p.click("button:has-text('Entrar')");
  }
  await p.waitForLoadState("networkidle");
  return p;
}
const esc = await sessao("escritorio");
const posto = rotas.some((r) => r.startsWith("/posto")) ? await sessao("posto") : null;
for (const r of rotas) {
  const p = r.startsWith("/posto") ? posto : esc;
  const resp = await p.goto(base + r, { waitUntil: "networkidle" });
  const nome = r.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "painel";
  await p.screenshot({ path: `${saida}/${nome}.png`, fullPage: true });
  console.log(resp.status(), r);
}
if (erros.length) console.log("ERROS:\n" + erros.join("\n"));
await browser.close();
