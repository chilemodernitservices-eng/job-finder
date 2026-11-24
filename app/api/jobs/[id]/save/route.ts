import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
import { getProfileId, guard, jsonError } from "@/app/lib/http";
export const runtime="nodejs";
export async function POST(_request:NextRequest,context:RouteContext<"/api/jobs/[id]/save">){
  const denied=await guard();if(denied)return denied;
  const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const {id}=await context.params;
  if(!sqlite.prepare("SELECT id FROM jobs WHERE id=?").get(id))return jsonError("Job not found",404);
  const found=sqlite.prepare("SELECT job_id FROM saved_jobs WHERE job_id=? AND profile_id=?").get(id, profileId);
  if(found){sqlite.prepare("DELETE FROM saved_jobs WHERE job_id=? AND profile_id=?").run(id, profileId);return NextResponse.json({saved:false});}
  sqlite.prepare("INSERT INTO saved_jobs(job_id,profile_id,created_at) VALUES(?,?,?)").run(id,profileId,new Date().toISOString());
  return NextResponse.json({saved:true});
}
