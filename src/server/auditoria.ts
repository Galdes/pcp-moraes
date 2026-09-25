import type { Sql } from "@/lib/db";
import { sql as sqlPadrao } from "@/lib/db";

export async function auditar(
  usuarioId: number | null,
  entidade: string,
  entidadeId: string | number,
  acao: string,
  dados?: unknown,
  tx: Sql = sqlPadrao,
) {
  await tx`insert into auditoria (usuario_id, entidade, entidade_id, acao, dados)
           values (${usuarioId}, ${entidade}, ${String(entidadeId)}, ${acao}, ${dados === undefined ? null : tx.json(dados as never)})`;
}
