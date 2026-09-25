import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PCP Moraes", template: "%s · PCP Moraes" },
  description: "Planejamento e Controle da Produção · Moraes Equipamentos",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { themeColor: "#112324" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
