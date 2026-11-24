import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
import { mapJobRow, verifyJob } from "@/app/lib/jobs";
import { RawJob } from "@/app/lib/contracts";
import { guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";
export async function POST(_request: NextRequest, context: RouteContext<"/api/jobs/[id]/verify">) {
  const denied=await guard(); if(denied)return denied;
  const {id}=await context.params;
  const row=sqlite.prepare("SELECT * FROM jobs WHERE id=?").get(id) as Record<string,unknown>|undefined;
  if(!row)return jsonError("Job not found",404);
  const j=mapJobRow(row);
  const input=RawJob.safeParse({title:j.title,company:j.company,city:j.city,remote:j.remote,description:j.description,applyUrl:j.applyUrl,applyEmail:j.applyEmail,postedAt:row.posted_at,validThrough:row.valid_through,source:j.source,trustTier:j.tier,sourceUrl:j.sourceUrl,applyMethod:j.applyMethod});
  if(!input.success)return jsonError("Job record is incomplete",409);
  const report=await verifyJob(input.data);
  sqlite.prepare("UPDATE jobs SET verification_status=?,verification_score=?,verification_report_json=?,verified_at=? WHERE id=?").run(report.status,report.score,JSON.stringify(report),new Date().toISOString(),id);
  return NextResponse.json({verification:report});
}
