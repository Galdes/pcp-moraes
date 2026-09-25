import { redirect } from "next/navigation";
import { timingSafeEqual } from "node:crypto";
import { Kanban } from "@/components/Kanban";
import { AutoAtualizar } from "@/components/AutoAtualizar";
import { quadroKanban } from "@/server/kanban";
import { kpis } from "@/server/indicadores";
import { usuarioAtual } from "@/server/auth";
import { fmtPct } from "@/lib/formato";

export const dynamic = "force-dynamic";
export const metadata = { title: "TV da fábrica" };

function tokenOk(t: string | undefined) {
  const esperado = process.env.TV_TOKEN;
  if (!esperado || !t) return false;
  const a = Buffer.from(t);
  const b = Buffer.from(esperado);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Tela para TV no chão de fábrica. Acesso com login ou com ?token=TV_TOKEN
// (a TV não precisa de usuário; o token só dá leitura desta tela).
export default async function TV({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  if (!tokenOk(sp.token) && !(await usuarioAtual())) redirect("/login");
  const [quadro, k] = await Promise.all([quadroKanban(), kpis(30)]);
  return (
    <div className="min-h-screen bg-petroleo p-5 text-white">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <div className="coord !text-latao">Moraes Equipamentos · Gestão à vista</div>
          <h1 className="text-3xl font-semibold">Produção agora</h1>
        </div>
        <div className="flex items-end gap-8 text-right">
          <div><div className="coord !text-white/50">Entregas no prazo</div><div className="text-4xl font-semibold tabular-nums">{fmtPct(k.otd)}</div></div>
          <div><div className="coord !text-white/50">Aderência semana</div><div className="text-4xl font-semibold tabular-nums">{fmtPct(k.aderencia)}</div></div>
          <div><div className="coord !text-white/50">Máquinas em processo</div><div className="text-4xl font-semibold tabular-nums">{k.wip}</div></div>
          <div><div className="coord !text-white/50">Em risco</div><div className={`text-4xl font-semibold tabular-nums ${k.atrasadas ? "text-red-400" : ""}`}>{k.atrasadas}</div></div>
          <AutoAtualizar segundos={30} />
        </div>
      </div>
      <Kanban quadro={quadro} tv />
    </div>
  );
}
