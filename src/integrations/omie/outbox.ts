import type { Sql } from "@/lib/db";

/** Enfileira um envio ao Omie. Idempotente: a mesma (tipo, referência) entra uma vez só. */
export async function enfileirarOmie(tx: Sql, tipo: string, referencia: string, payload: Record<string, unknown>) {
  await tx`
    insert into outbox (sistema, tipo, referencia, payload)
    values ('omie', ${tipo}, ${referencia}, ${tx.json(payload as never)})
    on conflict (sistema, tipo, referencia) do nothing`;
}
