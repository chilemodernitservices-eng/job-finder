import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { sqlite } from "@/app/lib/db";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const configured = process.env.CRON_SECRET || "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  if (!configured || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const users = sqlite.prepare("SELECT id FROM users ORDER BY created_at ASC").all() as { id: string }[];
  return NextResponse.json({ profiles: users.map((user) => user.id) });
}
