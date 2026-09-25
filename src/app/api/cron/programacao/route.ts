import { NextResponse } from "next/server";
import { autorizado } from "@/lib/token";
import { reprogramar } from "@/server/programacao";

// Recalcula a programação (ex.: a cada 30 min e às 6h). Bearer CRON_SECRET.
export async function POST(req: Request) {
  if (!autorizado(req, "CRON_SECRET")) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  return NextResponse.json(await reprogramar());
}
