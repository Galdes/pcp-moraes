import { FormLogin, FormPin } from "./FormLogin";

export const metadata = { title: "Entrar" };

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <div className="grid min-h-screen place-items-center bg-petroleo px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center text-white">
          <div className="coord !text-latao">Moraes Equipamentos</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Planejamento e Controle da Produção</h1>
        </div>
        <div className="card p-5">
          <h2 className="mb-3 text-sm font-semibold">Escritório</h2>
          <FormLogin />
        </div>
        <div className="card mt-4 p-5">
          <h2 className="mb-3 text-sm font-semibold">Chão de fábrica (tablet)</h2>
          <FormPin tarefa={sp.tarefa} />
        </div>
        <p className="mt-6 text-center text-xs text-white/40">por ESTG · Estratégia · Tecnologia · Gestão</p>
      </div>
    </div>
  );
}
