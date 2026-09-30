import { NextResponse } from "next/server";
import { autorizado } from "@/lib/token";
import { executarSincronizacao } from "@/integrations/omie/sync";
import { reprogramar } from "@/server/programacao";

// Limite do plano Hobby da Vercel. A sincronização trabalha ~45 s e continua na próxima chamada.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Chamado a cada 10 minutos pelo agendador (.github/workflows/agendador-omie.yml,
// cron do servidor ou scheduler da hospedagem) com Authorization: Bearer CRON_SECRET.
// Aceita POST e GET (o Cron da Vercel chama com GET).
async function rodar(req: Request) {
  if (!autorizado(req, "CRON_SECRET")) return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  const forcar = new URL(req.url).searchParams.get("forcar")?.split(",").filter(Boolean);
  const resultado = await executarSincronizacao({ forcar });
  if (resultado.some((r) => r.ok && ["pedidos", "estoque", "estrutura"].includes(r.entidade))) await reprogramar();
  return NextResponse.json({ resultado });
}
export const POST = rodar;
export const GET = rodar;
