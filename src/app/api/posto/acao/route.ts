import { NextResponse } from "next/server";
import { z } from "zod";
import { usuarioAtual } from "@/server/auth";
import { AcaoPosto, executarAcao } from "@/server/posto";
import { ErroDominio } from "@/domain/tipos";

const Corpo = z.object({ chave: z.string(), acao: AcaoPosto, quando: z.string().datetime().optional() });

export async function POST(req: Request) {
  const u = await usuarioAtual();
  if (!u) return NextResponse.json({ erro: "Sessão expirada: entre novamente" }, { status: 401 });
  if (u.perfil === "visualizador" || u.perfil === "diretoria") return NextResponse.json({ erro: "Seu perfil não aponta produção" }, { status: 403 });
  const parse = Corpo.safeParse(await req.json().catch(() => null));
  if (!parse.success) return NextResponse.json({ erro: "Requisição inválida" }, { status: 400 });
  // ação feita offline chega depois: vale o horário do tablet, dentro de limites
  let quando = new Date();
  if (parse.data.quando) {
    const q = new Date(parse.data.quando);
    const dif = Date.now() - q.getTime();
    if (dif > -5 * 60_000 && dif < 12 * 3_600_000) quando = q;
  }
  try {
    const r = await executarAcao(parse.data.chave, parse.data.acao, u.id, quando);
    return NextResponse.json(r);
  } catch (e) {
    if (e instanceof ErroDominio) return NextResponse.json({ erro: e.message }, { status: 422 });
    // violação de regra do banco é erro da ação, não do servidor: não pode travar a fila do tablet
    const code = (e as { code?: string }).code;
    if (code && /^(23|22)/.test(code)) return NextResponse.json({ erro: "Ação inconsistente com o que já foi registrado" }, { status: 422 });
    console.error("[posto]", e);
    return NextResponse.json({ erro: "Erro no servidor" }, { status: 500 });
  }
}
