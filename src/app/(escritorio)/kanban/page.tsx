import { Cabecalho } from "@/components/ui";
import { Kanban } from "@/components/Kanban";
import { AutoAtualizar } from "@/components/AutoAtualizar";
import { quadroKanban } from "@/server/kanban";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Kanban dos setores" };

export default async function PaginaKanban() {
  const quadro = await quadroKanban();
  return (
    <>
      <Cabecalho coord="Acompanhar" titulo="Kanban dos setores" sub="O que está parado, em processo e o que vem a seguir em cada setor. A ordem da fila é a da programação." acoes={<><AutoAtualizar segundos={30} /><Link href="/tv" className="btn-sec">Abrir modo TV</Link></>} />
      <Kanban quadro={quadro} />
    </>
  );
}
