import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { sqlite } from "@/app/lib/db";
import { getProfileId, guard, jsonError } from "@/app/lib/http";
import { mapJobRow } from "@/app/lib/jobs";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  const denied = await guard(); if (denied) return denied;
  const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const p = request.nextUrl.searchParams;
  const keyword = p.get("q")?.trim().slice(0, 120) || "";
  const city = p.get("city")?.trim().slice(0, 100) || "";
  const remote = p.get("remote");
  const verification = p.get("verification");
  const source = p.get("source");
  const sort = p.get("sort") === "score" ? "score" : "recent";
  const orderBy = sort === "score"
    ? "j.match_score DESC, COALESCE(j.posted_at,j.first_seen_at) DESC"
    : "COALESCE(j.posted_at,j.first_seen_at) DESC, j.match_score DESC";
  const minMatch = Number(p.get("minMatch") || 0);
  const limit = Math.min(200, Math.max(1, Number(p.get("limit") || 100)));
  let rows: Record<string, unknown>[];
  try {
    if (keyword && /^[\p{L}\p{N} _.-]+$/u.test(keyword)) {
      const terms = keyword.split(/\s+/).filter(Boolean).map(x => `"${x.replaceAll('"', '""')}"`).join(" AND ");
      rows = sqlite.prepare(`SELECT j.*,EXISTS(SELECT 1 FROM saved_jobs s WHERE s.job_id=j.id AND s.profile_id=?) AS saved FROM jobs j JOIN jobs_fts f ON f.job_id=j.id WHERE jobs_fts MATCH ? AND j.status='open' AND (?='' OR j.city LIKE '%'||?||'%') AND (?='' OR j.remote=?) AND (?='' OR j.verification_status=?) AND (?='' OR j.source=?) AND j.match_score>=? ORDER BY ${orderBy} LIMIT ?`).all(profileId, terms, city, city, remote || "", remote || "", verification || "", verification || "", source || "", source || "", Number.isFinite(minMatch) ? minMatch : 0, limit) as Record<string, unknown>[];
    } else throw new Error("Use LIKE fallback");
  } catch {
    rows = sqlite.prepare(`SELECT j.*,EXISTS(SELECT 1 FROM saved_jobs s WHERE s.job_id=j.id AND s.profile_id=?) AS saved FROM jobs j WHERE j.status='open' AND (?='' OR (title||' '||company_name||' '||description) LIKE '%'||?||'%') AND (?='' OR city LIKE '%'||?||'%') AND (?='' OR remote=?) AND (?='' OR verification_status=?) AND (?='' OR source=?) AND match_score>=? ORDER BY ${orderBy} LIMIT ?`).all(profileId, keyword, keyword, city, city, remote || "", remote || "", verification || "", verification || "", source || "", source || "", Number.isFinite(minMatch) ? minMatch : 0, limit) as Record<string, unknown>[];
  }
  return NextResponse.json({ jobs: rows.map(mapJobRow), count: rows.length });
}

export async function POST() { const denied = await guard(); if (denied) return denied; return jsonError("Use POST /api/jobs/link to add a posting URL", 405); }

export async function DELETE() {
  const denied = await guard(); if (denied) return denied;

  const jobCount = Number((sqlite.prepare("SELECT count(*) AS count FROM jobs").get() as {count:number}).count);
  const applicationCount = Number((sqlite.prepare("SELECT count(*) AS count FROM applications WHERE job_id IN (SELECT id FROM jobs)").get() as {count:number}).count);
  const cvPaths = (sqlite.prepare("SELECT tailored_cv_path FROM applications WHERE job_id IN (SELECT id FROM jobs) AND tailored_cv_path IS NOT NULL").all() as {tailored_cv_path:string}[]).map(row => row.tailored_cv_path);

  sqlite.exec("BEGIN IMMEDIATE");
  try {
    sqlite.prepare("DELETE FROM applications WHERE job_id IN (SELECT id FROM jobs)").run();
    sqlite.prepare("DELETE FROM saved_jobs WHERE job_id IN (SELECT id FROM jobs)").run();
    sqlite.prepare("DELETE FROM jobs_fts").run();
    sqlite.prepare("DELETE FROM jobs").run();
    sqlite.exec("COMMIT");
  } catch (error) {
    sqlite.exec("ROLLBACK");
    throw error;
  }

  const applicationCvDirectory = `${path.resolve(process.env.CV_DIR || "./data/cvs", "applications")}${path.sep}`;
  await Promise.all(cvPaths.map(async (filePath) => {
    const resolved = path.resolve(filePath);
    if (resolved.startsWith(applicationCvDirectory)) await fs.unlink(resolved).catch(() => {});
  }));

  return NextResponse.json({deletedJobs:jobCount,deletedApplications:applicationCount});
}
