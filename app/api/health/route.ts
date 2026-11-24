import { NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
export const runtime="nodejs";
export function GET(){try{sqlite.prepare("SELECT 1").get();return NextResponse.json({status:"ok",database:"connected",time:new Date().toISOString()});}catch{return NextResponse.json({status:"error",database:"unavailable"},{status:503});}}
