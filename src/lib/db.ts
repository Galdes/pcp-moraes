import postgres from "postgres";

// Tipos do Postgres convertidos para algo fácil de usar no TypeScript:
// numeric/bigint -> number (quantidades cabem com folga em double);
// date -> string 'YYYY-MM-DD' (evita o deslocamento de fuso de new Date()).
const tipos = {
  numeric: { to: 1700, from: [1700], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
  bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
  date: { to: 1082, from: [1082], serialize: (x: unknown) => String(x), parse: (x: string) => x },
};

export type Sql = postgres.Sql<{ numeric: number; bigint: number; date: string }>;

function criar(url: string): Sql {
  return postgres(url, {
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idle_timeout: 30,
    types: tipos as never,
    onnotice: () => {},
    // datas do banco (::date, now()::date) sempre no fuso da fábrica, mesmo com o servidor em UTC
    connection: { TimeZone: process.env.TZ_BANCO ?? "America/Sao_Paulo" },
  }) as unknown as Sql;
}

const globalo = globalThis as unknown as { __sql?: Sql };

export function getSql(): Sql {
  if (!globalo.__sql) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não configurada");
    globalo.__sql = criar(url);
  }
  return globalo.__sql;
}

export const sql: Sql = new Proxy((() => {}) as unknown as Sql, {
  get: (_t, p) => (getSql() as never)[p as never],
  apply: (_t, _this, args) => (getSql() as unknown as (...a: unknown[]) => unknown)(...args),
});

export function criarConexao(url: string): Sql {
  return criar(url);
}
