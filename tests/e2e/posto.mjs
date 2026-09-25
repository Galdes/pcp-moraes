// Fluxo real do tablet: operador do corte inicia e conclui uma etapa pela tela.
import { chromium } from "@playwright/test";
import postgres from "postgres";

const base = process.argv[2] ?? "http://localhost:3100";
const sql = postgres(process.env.DATABASE_URL);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const p = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
const erros = [];
p.on("pageerror", (e) => erros.push(e.message));
await p.goto(`${base}/login`);
await p.fill("#matricula", "1001");
await p.fill("#pin", "1234");
await p.click("text=Entrar no posto");
await p.waitForSelector("text=PRÓXIMA");
const [alvo] = await sql`select t.id, t.quantidade from tarefas t join ordens_producao o on o.id = t.op_id join setores s on s.id = t.setor_id
  where s.codigo = 'CORTE' and t.status = 'pendente' and o.status in ('liberada','em_processo')
  and not exists (select 1 from tarefa_dependencias d join tarefas x on x.id = d.depende_de_id where d.tarefa_id = t.id and x.status <> 'concluida')
  order by t.fila_manual nulls last, t.inicio_previsto limit 1`;
await p.locator(`#t-${alvo.id} button:has-text("Iniciar")`).click();
await p.waitForSelector(`#t-${alvo.id} button:has-text("Concluir")`);
await p.waitForTimeout(1500);
let [t] = await sql`select status from tarefas where id = ${alvo.id}`;
console.log("após iniciar:", t.status);
await p.screenshot({ path: "/home/claude/shots/posto_iniciado.png" });
await p.locator(`#t-${alvo.id} button:has-text("Concluir")`).click();
await p.waitForSelector("text=Concluir etapa");
await p.screenshot({ path: "/home/claude/shots/posto_concluir.png" });
await p.click("text=Concluir etapa");
await p.waitForTimeout(2000);
[t] = await sql`select status, qtd_boa from tarefas where id = ${alvo.id}`;
console.log("após concluir:", t.status, t.qtd_boa, "esperado", alvo.quantidade);
// parada de setor
await p.click("text=Setor parou (sem OP)");
await p.click("text=Quebra de máquina");
await p.waitForSelector("text=Voltou a funcionar");
await p.screenshot({ path: "/home/claude/shots/posto_parado.png" });
await p.click("text=Voltou a funcionar");
await p.waitForTimeout(1500);
const [par] = await sql`select count(*)::int as abertas from paradas where tarefa_id is null and fim is null`;
console.log("paradas de setor abertas:", par.abertas);
console.log(erros.length ? "ERROS: " + erros.join(" | ") : "sem erros de página");
await browser.close();
await sql.end();
