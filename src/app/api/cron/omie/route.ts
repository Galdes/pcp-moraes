import { NextResponse } from "next/server";
import { autorizado } from "@/lib/token";
import { executarSincronizacao } from "@/integrations/omie/sync";
import { reprogramar } from "@/server/programacao";

// Chamado a cada 5 a 10 minutos por um agendador (cron do servidor ou
// scheduler da hospedagem): POST /api/cron/omie com Authorization: Bearer CRON_SECRET
export async function POST(req: Request) {
  if (!autorizado(req, "CRON_SECRET")) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const forcar = new URL(req.url).searchParams.get("forcar")?.split(",").filter(Boolean);
  const resultado = await executarSincronizacao({ forcar });
  if (resultado.some((r) => r.ok && ["pedidos", "estoque", "estrutura"].includes(r.entidade))) await reprogramar();
  return NextResponse.json({ resultado });
}
