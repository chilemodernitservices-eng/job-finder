import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/app/lib/db";
import { ParsedCv, Preferences, SearchTargets, Settings } from "@/app/lib/contracts";
import { getProfileId, guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";
const defaultEmailDisplayName = () => {
  const from = process.env.SMTP_FROM?.trim() || "";
  const match = from.match(/^\s*[\"']?([^<>\"']+?)[\"']?\s*<[^>]+>\s*$/);
  return match?.[1]?.trim() || "";
};
const read = (profileId: string) => {
  const row = sqlite.prepare("SELECT * FROM profile WHERE id=?").get(profileId) as Record<string, unknown>;
  const settings = Settings.parse(JSON.parse(String(row.settings_json)));
  if (!settings.emailDisplayName) settings.emailDisplayName = defaultEmailDisplayName();
  return { profile: ParsedCv.parse(JSON.parse(String(row.parsed_json))), searchTargets: SearchTargets.parse(JSON.parse(String(row.search_targets_json))), preferences: Preferences.parse(JSON.parse(String(row.preferences_json))), settings, cvUploaded: !!row.cv_path, integrations:{openRouter:!!process.env.OPENROUTER_API_KEY,openai:!!process.env.OPENAI_API_KEY,groq:!!process.env.GROQ_API_KEY,smtp:!!(process.env.SMTP_HOST&&process.env.SMTP_USER&&process.env.SMTP_PASS),webSearch:!!process.env.SEARCHAPI_API_KEY,xSearch:!!process.env.X_BEARER_TOKEN}, updatedAt: row.updated_at };
};
export async function GET() { const denied = await guard(); if (denied) return denied; const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401); return NextResponse.json(read(profileId)); }
export async function PUT(request: NextRequest) {
  const denied = await guard(); if (denied) return denied;
  const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Expected a profile object");
  try {
    const existing = read(profileId);
    const profile = body.profile ? ParsedCv.parse(body.profile) : existing.profile;
    const searchTargets = body.searchTargets ? SearchTargets.parse(body.searchTargets) : existing.searchTargets;
    const preferences = body.preferences ? Preferences.parse(body.preferences) : existing.preferences;
    const settings = body.settings ? Settings.parse(body.settings) : existing.settings;
    if (settings.autopilotLevel !== 0) return jsonError("Autopilot remains disabled until the evaluation gate from plan.md is implemented and passed", 409);
    sqlite.prepare("UPDATE profile SET parsed_json=?,search_targets_json=?,preferences_json=?,settings_json=?,updated_at=? WHERE id=?").run(JSON.stringify(profile), JSON.stringify(searchTargets), JSON.stringify(preferences), JSON.stringify(settings), new Date().toISOString(), profileId);
    return NextResponse.json(read(profileId));
  } catch { return jsonError("Profile validation failed"); }
}
