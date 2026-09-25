import { NextResponse } from "next/server";
import { autorizado } from "@/lib/token";
import { resumoParaMonday } from "@/integrations/monday/resumo";

// Lido pelo N8N para atualizar o quadro executivo no Monday. Bearer EXPORT_TOKEN.
export async function GET(req: Request) {
  if (!autorizado(req, "EXPORT_TOKEN")) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  return NextResponse.json(await resumoParaMonday(), { headers: { "Cache-Control": "no-store" } });
}
