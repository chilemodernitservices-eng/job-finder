import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("users_email_uq").on(t.email)]);

export const profiles = sqliteTable("profile", {
  id: text("id").primaryKey(),
  cvPath: text("cv_path"),
  parsedJson: text("parsed_json").notNull().default("{}"),
  searchTargetsJson: text("search_targets_json").notNull().default("{}"),
  preferencesJson: text("preferences_json").notNull().default("{}"),
  settingsJson: text("settings_json").notNull().default('{"autopilotLevel":0,"dailyCap":5,"companyCooldownDays":30,"minMatch":0.5,"autoMatch":0.75}'),
  updatedAt: text("updated_at").notNull(),
});

export const companies = sqliteTable("companies", {
  id: text("id").primaryKey(), name: text("name").notNull(), domain: text("domain"),
  atsType: text("ats_type"), atsSlug: text("ats_slug"), careersUrl: text("careers_url"),
  verified: integer("verified", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), fingerprint: text("fingerprint").notNull(), source: text("source").notNull(),
  trustTier: text("trust_tier").notNull().default("C"), externalId: text("external_id"), title: text("title").notNull(),
  companyId: text("company_id"), companyName: text("company_name").notNull(), city: text("city"), remote: text("remote").notNull().default("unknown"),
  description: text("description").notNull().default(""), applyUrl: text("apply_url"), applyMethod: text("apply_method").notNull().default("assisted"),
  applyEmail: text("apply_email"), postedAt: text("posted_at"), validThrough: text("valid_through"), firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(), status: text("status").notNull().default("open"), verificationStatus: text("verification_status").notNull().default("needs_review"),
  repostCount: integer("repost_count").notNull().default(0),
  verificationScore: real("verification_score").notNull().default(0), verificationReportJson: text("verification_report_json").notNull().default("{}"),
  verifiedAt: text("verified_at"), matchScore: real("match_score").notNull().default(0), matchReasonsJson: text("match_reasons_json").notNull().default("[]"),
  sourceUrl: text("source_url"),
}, (t) => [uniqueIndex("jobs_fingerprint_uq").on(t.fingerprint), index("jobs_verification_match_idx").on(t.verificationStatus, t.matchScore), index("jobs_company_idx").on(t.companyId)]);

export const applications = sqliteTable("applications", {
  id: text("id").primaryKey(), jobId: text("job_id").notNull(), profileId: text("profile_id").notNull(), status: text("status").notNull(),
  method: text("method").notNull(), tailoredCvPath: text("tailored_cv_path"), coverLetter: text("cover_letter"), answersJson: text("answers_json").notNull().default("{}"),
  sentAt: text("sent_at"), error: text("error"), eventsJson: text("events_json").notNull().default("[]"), createdAt: text("created_at").notNull(),
}, (t) => [uniqueIndex("application_job_profile_uq").on(t.jobId, t.profileId), index("application_status_idx").on(t.status)]);

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(), startedAt: text("started_at").notNull(), finishedAt: text("finished_at"),
  sourceCountsJson: text("source_counts_json").notNull().default("{}"), found: integer("found").notNull().default(0), new: integer("new").notNull().default(0),
  verified: integer("verified").notNull().default(0), rejected: integer("rejected").notNull().default(0), errorsJson: text("errors_json").notNull().default("[]"), status: text("status").notNull().default("queued"),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(), type: text("type").notNull(), payloadJson: text("payload_json").notNull(), status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0), runAt: text("run_at").notNull(), lastError: text("last_error"),
});

export const llmCalls = sqliteTable("llm_calls", {
  id: text("id").primaryKey(), task: text("task").notNull(), model: text("model").notNull(), tokensIn: integer("tokens_in").default(0),
  tokensOut: integer("tokens_out").default(0), cost: real("cost").default(0), promptVersion: text("prompt_version").notNull(), createdAt: text("created_at").notNull(),
});

export const inboxMessages = sqliteTable("inbox_messages", {
  id: text("id").primaryKey(), messageId: text("message_id").notNull(), sender: text("sender"), subject: text("subject"),
  parsedLinksJson: text("parsed_links_json").notNull().default("[]"), processedAt: text("processed_at"),
}, (t) => [uniqueIndex("inbox_message_uq").on(t.messageId)]);
