import { NextResponse } from "next/server";
import { autorizado } from "@/lib/token";
import { reprogramar } from "@/server/programacao";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Recalcula a programação (ex.: a cada 30 min e às 6h). Bearer CRON_SECRET. Aceita POST e GET.
async function rodar(req: Request) {
  if (!autorizado(req, "CRON_SECRET")) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  return NextResponse.json(await reprogramar());
}
export const POST = rodar;
export const GET = rodar;
