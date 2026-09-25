// Tablet sem rede: a ação fica na fila local e é enviada quando a rede volta.
// Também testa o QR da ficha (/posto?tarefa=ID) abrindo direto no setor certo.
import { chromium } from "@playwright/test";
import postgres from "postgres";

const base = process.argv[2] ?? "http://localhost:3100";
const sql = postgres(process.env.DATABASE_URL);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 } });
const p = await ctx.newPage();
const [alvo] = await sql`select t.id, s.nome from tarefas t join ordens_producao o on o.id = t.op_id join setores s on s.id = t.setor_id
  where t.status = 'pendente' and o.status in ('liberada','em_processo') and s.codigo <> 'CORTE'
  and not exists (select 1 from tarefa_dependencias d join tarefas x on x.id = d.depende_de_id where d.tarefa_id = t.id and x.status <> 'concluida')
  limit 1`;
const [alvoCorte] = await sql`select t.id from tarefas t join ordens_producao o on o.id = t.op_id join setores s on s.id = t.setor_id
  where t.status = 'pendente' and o.status in ('liberada','em_processo') and s.codigo = 'CORTE'
  and not exists (select 1 from tarefa_dependencias d join tarefas x on x.id = d.depende_de_id where d.tarefa_id = t.id and x.status <> 'concluida')
  limit 1`;
const qr = alvo ?? alvoCorte;
await p.goto(`${base}/posto?tarefa=${qr.id}`); // sem sessão: vai para o login e volta para a tarefa
await p.fill("#matricula", "1002");
await p.fill("#pin", "1234");
await p.click("text=Entrar no posto");
await p.waitForSelector(`#t-${qr.id}`);
console.log("QR abriu no setor:", (await p.locator("header .text-xl").textContent()).trim(), alvo ? `(esperado ${alvo.nome})` : "");

await ctx.setOffline(true);
const botao = p.locator(`#t-${qr.id} button:has-text("Iniciar")`);
await botao.click();
await p.waitForSelector("text=sem rede");
const pend = await p.locator("header").textContent();
console.log("offline, cabeçalho:", pend.includes("a enviar") ? "mostra ação pendente" : pend);
let [t] = await sql`select status from tarefas where id = ${qr.id}`;
console.log("no servidor durante offline:", t.status);
await ctx.setOffline(false);
await p.waitForTimeout(12_000);
[t] = await sql`select status from tarefas where id = ${qr.id}`;
const [{ n }] = await sql`select count(*)::int as n from apontamentos where tarefa_id = ${qr.id}`;
console.log("após voltar a rede:", t.status, "apontamentos:", n);
await browser.close();
await sql.end();
