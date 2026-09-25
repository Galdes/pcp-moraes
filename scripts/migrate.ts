import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

export async function migrar(url: string, reset = false) {
  const sql = postgres(url, { onnotice: () => {} });
  try {
    if (reset) {
      await sql.unsafe("drop schema public cascade; create schema public;");
    }
    await sql`create table if not exists _migracoes (nome text primary key, aplicada_em timestamptz not null default now())`;
    const dir = path.join(__dirname, "..", "db", "migrations");
    const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    const aplicadas = new Set((await sql`select nome from _migracoes`).map((r) => r.nome as string));
    for (const f of arquivos) {
      if (aplicadas.has(f)) continue;
      const conteudo = readFileSync(path.join(dir, f), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(conteudo);
        await tx`insert into _migracoes (nome) values (${f})`;
      });
      console.log(`migração aplicada: ${f}`);
    }
  } finally {
    await sql.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL não configurada");
    process.exit(1);
  }
  migrar(url, process.argv.includes("--reset")).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
