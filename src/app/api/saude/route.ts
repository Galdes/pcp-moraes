import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function GET() {
  try {
    await sql`select 1`;
    return NextResponse.json({ ok: true, banco: "ok", hora: new Date().toISOString() });
  } catch {
    return NextResponse.json({ ok: false, banco: "indisponível" }, { status: 503 });
  }
}
