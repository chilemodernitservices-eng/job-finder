import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { login, register, jsonError, getSessionUser, logout } from "@/app/lib/http";

export const runtime = "nodejs";
const failures=new Map<string,{count:number;reset:number}>();
export async function GET() {
  const user = await getSessionUser();
  return NextResponse.json({ authenticated: !!user, user });
}
export async function DELETE() {
  await logout();
  return NextResponse.json({ ok: true });
}
export async function POST(request: NextRequest) {
  const client=request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()||"local";
  const state=failures.get(client);
  if(state&&state.reset>Date.now()&&state.count>=5)return jsonError("Too many sign-in attempts. Try again in 15 minutes.",429);
  const body = await request.json().catch(() => null);
  const parsed = z.object({ action: z.enum(["login", "register"]).default("login"), name: z.string().trim().min(2).max(120).optional(), email: z.string().trim().email().max(254).optional(), password: z.string().min(8).max(256) }).safeParse(body);
  if (!parsed.success) return jsonError("Enter a valid name, email, and password (at least 8 characters)", 400);
  try {
    if (parsed.data.action === "register") {
      if (!parsed.data.name || !parsed.data.email) return jsonError("Name and email are required", 400);
      return NextResponse.json({ ok: true, user: await register(parsed.data.name, parsed.data.email, parsed.data.password) });
    }
    const user = await login(parsed.data.password, parsed.data.email);
    if (!user) {const current=failures.get(client);failures.set(client,{count:(current&&current.reset>Date.now()?current.count:0)+1,reset:Date.now()+15*60_000});return jsonError("Incorrect email or password", 401);}
    failures.delete(client);
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not create account", 400);
  }
}
