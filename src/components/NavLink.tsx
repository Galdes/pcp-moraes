"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const p = usePathname();
  const ativo = href === "/" ? p === "/" : p === href || p.startsWith(href + "/");
  return (
    <Link
      href={href}
      className={`block rounded-md px-3 py-1.5 text-sm transition ${ativo ? "bg-white/10 font-medium text-white" : "text-white/70 hover:bg-white/5 hover:text-white"}`}
    >
      {ativo && <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-latao align-middle" />}
      {children}
    </Link>
  );
}
