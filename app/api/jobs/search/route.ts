import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { sqlite } from "@/app/lib/db";
import {
  ParsedCv,
  Preferences,
  Settings,
  type RawJob as RawJobType,
} from "@/app/lib/contracts";
import { fetchPublicJobListings, fetchWatchlistJobListings, isNigeriaSoftwareRole, persistJob } from "@/app/lib/jobs";
import { getProfileId, getWorkerProfileId, guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";
export const maxDuration = 300;
function cronAuthorized(request: NextRequest) {
  const configured = process.env.CRON_SECRET;
  const supplied =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!configured || !supplied) return false;
  const a = Buffer.from(configured);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function POST(request: NextRequest) {
  if (!cronAuthorized(request)) {
    const denied = await guard();
    if (denied) return denied;
  }
  const profileId = cronAuthorized(request) ? getWorkerProfileId(request) : await getProfileId();
  if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const profileRow = sqlite
    .prepare(
      "SELECT parsed_json,preferences_json FROM profile WHERE id=?",
    )
    .get(profileId) as { parsed_json: string; preferences_json: string };
  const profile = ParsedCv.parse(JSON.parse(profileRow.parsed_json));
  const preferences = Preferences.parse(
    JSON.parse(profileRow.preferences_json),
  );
  const settingsRow = sqlite
    .prepare("SELECT settings_json FROM profile WHERE id=?")
    .get(profileId) as { settings_json: string };
  const settings = Settings.parse(JSON.parse(settingsRow.settings_json));
  if (!profile.skills.length && !preferences.titles.length)
    return jsonError(
      "Add your target job titles or upload and review your CV before running discovery",
      409,
    );
  const watchlist = preferences.companyWatchlist;
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  sqlite
    .prepare("INSERT INTO runs(id,started_at,status) VALUES(?,?,'running')")
    .run(runId, startedAt);
  sqlite
    .prepare(
      "INSERT INTO tasks(id,type,payload_json,status,run_at) VALUES(?,'discover',?,'running',?)",
    )
    .run(randomUUID(), JSON.stringify({ runId }), startedAt);
  const sourceCounts: Record<string, number> = {};
  const errors: string[] = [];
  try {
    const roleTitles = [
      "frontend developer",
      "front-end developer",
      "front end developer",
      "frontend engineer",
      "front-end engineer",
      "backend developer",
      "back-end developer",
      "back end developer",
      "backend engineer",
      "back-end engineer",
      "full stack developer",
      "full stack engineer",
    ];
    const [boardResults, publicResults] = await Promise.all([
      fetchWatchlistJobListings(watchlist),
      fetchPublicJobListings([...roleTitles, ...preferences.titles, ...profile.skills.slice(0, 10)], true, startedAt),
    ]);
    const fetched = { jobs: [...boardResults.jobs, ...publicResults.jobs], errors: [...boardResults.errors, ...publicResults.errors] };
    const searchWords = [
      ...roleTitles,
      ...preferences.titles,
      ...profile.skills.slice(0, 10),
    ].map((x) => x.toLowerCase());
    const relevant = fetched.jobs.filter(
      (j: RawJobType) =>
        isNigeriaSoftwareRole(j) &&
        (!searchWords.length ||
          searchWords.some((w) =>
            `${j.title} ${j.description.slice(0, 3000)}`
              .toLowerCase()
              .includes(w),
          )),
    );
    const batch = relevant.slice(0, 80);
    let newCount = 0;
    let verifiedCount = 0;
    let rejectedCount = 0;
    for (const item of batch) {
      const spend = sqlite
        .prepare(
          "SELECT coalesce(sum(cost),0) AS total FROM llm_calls WHERE created_at>=?",
        )
        .get(startedAt) as { total: number };
      if (spend.total >= settings.perRunBudgetUsd) {
        errors.push(
          "paused: per-run AI budget reached; remaining jobs were left for a later run",
        );
        break;
      }
      try {
        const record = await persistJob(item, profile, preferences, startedAt);
        if (record.isNew) newCount++;
        if (record.verificationStatus === "verified") verifiedCount++;
        if (record.verificationStatus === "rejected") rejectedCount++;
        sourceCounts[item.source] = (sourceCounts[item.source] || 0) + 1;
      } catch (e) {
        errors.push(
          `${item.company} / ${item.title}: ${e instanceof Error ? e.message : "Job processing failed"}`,
        );
      }
    }
    const summary = {
      found: fetched.jobs.length,
      processed: batch.length,
      new: newCount,
      verified: verifiedCount,
      rejected: rejectedCount,
      errors,
      sourceCounts,
    };
    sqlite
      .prepare(
        "UPDATE runs SET finished_at=?,source_counts_json=?,found=?,new=?,verified=?,rejected=?,errors_json=?,status=? WHERE id=?",
      )
      .run(
        new Date().toISOString(),
        JSON.stringify(sourceCounts),
        fetched.jobs.length,
        newCount,
        verifiedCount,
        rejectedCount,
        JSON.stringify(errors),
        errors.some((e) => e.includes("budget reached"))
          ? "paused_budget"
          : errors.length
            ? "completed_with_errors"
            : "completed",
        runId,
      );
    sqlite
      .prepare(
        "UPDATE tasks SET status='done' WHERE type='discover' AND payload_json=?",
      )
      .run(JSON.stringify({ runId }));
    return NextResponse.json({ runId, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Job search failed";
    sqlite
      .prepare(
        "UPDATE runs SET finished_at=?,errors_json=?,status='failed' WHERE id=?",
      )
      .run(new Date().toISOString(), JSON.stringify([message]), runId);
    return jsonError(message, 502);
  }
}
