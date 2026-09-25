"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function AutoAtualizar({ segundos = 30 }: { segundos?: number }) {
  const router = useRouter();
  const [hora, setHora] = useState<string>("");
  useEffect(() => {
    const marcar = () => setHora(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    marcar();
    const id = setInterval(() => {
      router.refresh();
      marcar();
    }, segundos * 1000);
    return () => clearInterval(id);
  }, [router, segundos]);
  return <span className="text-xs opacity-60">atualizado {hora} · a cada {segundos}s</span>;
}
