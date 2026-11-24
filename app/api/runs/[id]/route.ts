import { NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
import { guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: RouteContext<"/api/runs/[id]">) {
  const denied=await guard(); if(denied)return denied;
  const {id}=await context.params;
  const row=sqlite.prepare("SELECT * FROM runs WHERE id=?").get(id) as Record<string,unknown>|undefined;
  if(!row)return jsonError("Run not found",404);
  return NextResponse.json({run:{...row,sourceCounts:JSON.parse(String(row.source_counts_json||"{}")),errors:JSON.parse(String(row.errors_json||"[]"))}});
}
