import { NextResponse } from "next/server";
import { sair } from "@/server/auth";

export async function POST(req: Request) {
  await sair();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
