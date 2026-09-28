import Link from "next/link";
import { exigir, ESCRITORIO, NOME_PERFIL } from "@/server/auth";
import { NavLink } from "@/components/NavLink";
import { sairAction } from "@/app/login/actions";

export default async function LayoutEscritorio({ children }: { children: React.ReactNode }) {
  const u = await exigir(...ESCRITORIO);
  const grupos: [string, [string, string][]][] = [
    ["Acompanhar", [["/", "Painel"], ["/kanban", "Kanban dos setores"], ["/tv", "Modo TV"]]],
    ["Planejar", [["/pedidos", "Pedidos de venda"], ["/ops", "Ordens de produção"], ["/programacao", "Programação"], ["/mrp", "MRP e compras"]]],
    ["Engenharia", [["/cadastros/itens", "Itens e estruturas"], ["/cadastros/setores", "Setores e capacidade"], ["/cadastros/motivos", "Motivos de parada"], ["/qualidade", "Qualidade dos dados"]]],
    ["Sistema", [["/integracoes", "Integrações Omie"], ["/cadastros/usuarios", "Usuários"]]],
  ];
  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print bg-petroleo text-white lg:sticky lg:top-0 lg:h-screen lg:w-60 lg:shrink-0 lg:overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-4 lg:block">
          <Link href="/" className="block">
            <div className="coord !text-latao">Moraes Equipamentos</div>
            <div className="text-lg font-semibold tracking-tight">PCP</div>
          </Link>
          <Link href="/posto" className="text-xs text-white/60 underline lg:hidden">Posto</Link>
        </div>
        <nav className="flex gap-4 overflow-x-auto px-3 pb-3 lg:block lg:space-y-5 lg:overflow-visible">
          {grupos.map(([g, links]) => (
            <div key={g} className="min-w-44 lg:min-w-0">
              <div className="coord mb-1 px-3 !text-white/40">{g}</div>
              <div className="space-y-0.5">
                {links.map(([h, t]) => (
                  <NavLink key={h} href={h}>{t}</NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 px-4 py-3 text-xs text-white/60 lg:block">
          <div className="font-medium text-white">{u.nome}</div>
          <div>{NOME_PERFIL[u.perfil]}</div>
          <form action={sairAction} className="mt-2">
            <button className="underline hover:text-white">Sair</button>
          </form>
          <div className="mt-3 coord !text-white/30">por ESTG · Estratégia · Tecnologia · Gestão</div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}
