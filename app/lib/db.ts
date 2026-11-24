import "server-only";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/node-sqlite";
import * as schema from "./schema";
import path from "node:path";
import fs from "node:fs";

const dbPath = path.resolve(process.env.DATABASE_PATH || "./data/app.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });

const globalForDb = globalThis as typeof globalThis & { sqlite?: DatabaseSync };
const sqlite = globalForDb.sqlite ?? new DatabaseSync(dbPath);
if (process.env.NODE_ENV !== "production") globalForDb.sqlite = sqlite;
sqlite.exec(
  "PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
);
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profile (id TEXT PRIMARY KEY, cv_path TEXT, parsed_json TEXT NOT NULL DEFAULT '{}', search_targets_json TEXT NOT NULL DEFAULT '{}', preferences_json TEXT NOT NULL DEFAULT '{}', settings_json TEXT NOT NULL DEFAULT '{"autopilotLevel":0,"dailyCap":5,"companyCooldownDays":30,"minMatch":0.5,"autoMatch":0.75}', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, ats_type TEXT, ats_slug TEXT, careers_url TEXT, verified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL UNIQUE, source TEXT NOT NULL, trust_tier TEXT NOT NULL DEFAULT 'C', external_id TEXT, title TEXT NOT NULL, company_id TEXT, company_name TEXT NOT NULL, city TEXT, remote TEXT NOT NULL DEFAULT 'unknown', description TEXT NOT NULL DEFAULT '', apply_url TEXT, apply_method TEXT NOT NULL DEFAULT 'assisted', apply_email TEXT, posted_at TEXT, valid_through TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', verification_status TEXT NOT NULL DEFAULT 'needs_review', repost_count INTEGER NOT NULL DEFAULT 0, verification_score REAL NOT NULL DEFAULT 0, verification_report_json TEXT NOT NULL DEFAULT '{}', verified_at TEXT, match_score REAL NOT NULL DEFAULT 0, match_reasons_json TEXT NOT NULL DEFAULT '[]', source_url TEXT);
CREATE TABLE IF NOT EXISTS applications (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), profile_id TEXT NOT NULL REFERENCES profile(id), status TEXT NOT NULL, method TEXT NOT NULL, tailored_cv_path TEXT, cover_letter TEXT, answers_json TEXT NOT NULL DEFAULT '{}', sent_at TEXT, error TEXT, events_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, UNIQUE(job_id,profile_id));
CREATE TABLE IF NOT EXISTS saved_jobs (job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, profile_id TEXT NOT NULL REFERENCES profile(id), created_at TEXT NOT NULL, PRIMARY KEY(job_id,profile_id));
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT, source_counts_json TEXT NOT NULL DEFAULT '{}', found INTEGER NOT NULL DEFAULT 0, new INTEGER NOT NULL DEFAULT 0, verified INTEGER NOT NULL DEFAULT 0, rejected INTEGER NOT NULL DEFAULT 0, errors_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'queued');
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, type TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, run_at TEXT NOT NULL, last_error TEXT);
CREATE TABLE IF NOT EXISTS llm_calls (id TEXT PRIMARY KEY, task TEXT NOT NULL, model TEXT NOT NULL, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0, cost REAL DEFAULT 0, prompt_version TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS inbox_messages (id TEXT PRIMARY KEY, message_id TEXT NOT NULL UNIQUE, sender TEXT, subject TEXT, parsed_links_json TEXT NOT NULL DEFAULT '[]', processed_at TEXT);
CREATE INDEX IF NOT EXISTS jobs_verification_match_idx ON jobs(verification_status,match_score);
CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company_id);
CREATE INDEX IF NOT EXISTS applications_status_idx ON applications(status);
CREATE VIRTUAL TABLE IF NOT EXISTS jobs_fts USING fts5(job_id UNINDEXED,title,description,company_name, tokenize='unicode61 remove_diacritics 2');
`);
const jobColumns = sqlite.prepare("PRAGMA table_info(jobs)").all() as {
  name: string;
}[];
if (!jobColumns.some((column) => column.name === "repost_count"))
  sqlite.exec(
    "ALTER TABLE jobs ADD COLUMN repost_count INTEGER NOT NULL DEFAULT 0",
  );

const now = new Date().toISOString();
sqlite
  .prepare("INSERT OR IGNORE INTO profile(id,updated_at) VALUES('default',?)")
  .run(now);
const firstUser = sqlite.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
if (firstUser && !sqlite.prepare("SELECT id FROM profile WHERE id=?").get(firstUser.id)) {
  sqlite.prepare("INSERT INTO profile(id,cv_path,parsed_json,search_targets_json,preferences_json,settings_json,updated_at) SELECT ?,cv_path,parsed_json,search_targets_json,preferences_json,settings_json,updated_at FROM profile WHERE id='default'").run(firstUser.id);
  sqlite.prepare("UPDATE applications SET profile_id=? WHERE profile_id='default'").run(firstUser.id);
  sqlite.prepare("UPDATE saved_jobs SET profile_id=? WHERE profile_id='default'").run(firstUser.id);
}

export const db = drizzle({ client: sqlite, schema });
export { sqlite };
