import { NextRequest, NextResponse } from "next/server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { sqlite } from "@/app/lib/db";
import { RawJob } from "@/app/lib/contracts";
import { mapJobRow, verifyJob } from "@/app/lib/jobs";
import { guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";
const cronAuthorized = (request: NextRequest) => {
  const configured = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!configured || !supplied) return false;
  const expected = Buffer.from(configured);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    const denied = await guard();
    if (denied) return denied;
  }
  const taskId = randomUUID();
  const startedAt = new Date().toISOString();
  sqlite.prepare("INSERT INTO tasks(id,type,payload_json,status,run_at) VALUES(?,'reverify',?,'running',?)").run(taskId, JSON.stringify({ startedAt }), startedAt);
  const rows = sqlite.prepare("SELECT * FROM jobs WHERE status='open' AND (verified_at IS NULL OR verified_at < datetime('now','-48 hours')) ORDER BY COALESCE(verified_at, first_seen_at) ASC LIMIT 50").all() as Record<string, unknown>[];
  let verified = 0;
  let rejected = 0;
  let failed = 0;
  const errors: string[] = [];
  try {
    for (const row of rows) {
      try {
        const job = mapJobRow(row);
        const input = RawJob.safeParse({ title: job.title, company: job.company, city: job.city, remote: job.remote, description: job.description, applyUrl: job.applyUrl, applyEmail: job.applyEmail, postedAt: row.posted_at, validThrough: row.valid_through, source: job.source, trustTier: job.tier, sourceUrl: job.sourceUrl, applyMethod: job.applyMethod });
        if (!input.success) throw new Error("Job record is incomplete");
        const report = await verifyJob(input.data);
        sqlite.prepare("UPDATE jobs SET verification_status=?,verification_score=?,verification_report_json=?,verified_at=? WHERE id=?").run(report.status, report.score, JSON.stringify(report), new Date().toISOString(), String(row.id));
        if (report.status === "verified") verified++;
        if (report.status === "rejected") rejected++;
      } catch (error) {
        failed++;
        errors.push(`${String(row.company_name)} / ${String(row.title)}: ${error instanceof Error ? error.message : "Re-verification failed"}`);
      }
    }
    const summary = { checked: rows.length, verified, rejected, failed, errors };
    sqlite.prepare("UPDATE tasks SET status='done',last_error=? WHERE id=?").run(errors.length ? JSON.stringify(errors) : null, taskId);
    return NextResponse.json({ taskId, summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Re-verification failed";
    sqlite.prepare("UPDATE tasks SET status='failed',last_error=? WHERE id=?").run(message, taskId);
    return jsonError(message, 502);
  }
}
