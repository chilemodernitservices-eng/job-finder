import { NextRequest, NextResponse } from "next/server";
import { createRequire } from "node:module";
import { sqlite } from "@/app/lib/db";
import { ParsedCv, Preferences, RawJob, Settings, TailoredCv } from "@/app/lib/contracts";
import { verifyJob, mapJobRow, checkListingOpen } from "@/app/lib/jobs";
import { getProfileId, guard, jsonError } from "@/app/lib/http";
import { ensureCoverLetterSignature, originalCvView, writeCvPdf } from "@/app/lib/materials";
import { z } from "zod";

export const runtime = "nodejs";
const require = createRequire(`${process.cwd()}/package.json`);
const Events = z.array(
  z.object({ at: z.string(), event: z.string(), message: z.string() }),
);

export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/applications/[id]/approve">,
) {
  const denied = await guard();
  if (denied) return denied;
  const profileId = await getProfileId();
  if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const body = z
    .object({
      recruiterEmail: z.string().max(254).optional(),
      coverLetter: z.string().max(22000).optional(),
    })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return jsonError("Enter a valid recruiter email address");
  const typedEmail = body.data.recruiterEmail?.trim() || "";
  const editedCoverLetter = body.data.coverLetter?.trim();
  if (typedEmail && !z.string().email().max(254).safeParse(typedEmail).success)
    return jsonError("Enter a valid recruiter email address");
  const { id } = await context.params;
  const row = sqlite
    .prepare(
      "SELECT a.id AS application_id,a.status AS application_status,a.events_json AS application_events_json,a.cover_letter AS application_cover_letter,a.answers_json AS application_answers_json,a.tailored_cv_path AS application_cv_path,a.job_id AS application_job_id,j.* FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=? AND a.profile_id=?",
    )
    .get(id, profileId) as Record<string, unknown> | undefined;
  if (!row) return jsonError("Application not found", 404);
  if (row.application_status === "sent")
    return jsonError("This application has already been sent", 409);
  const preparedMaterials = JSON.parse(
    String(row.application_answers_json || "{}"),
  ) as {
    factCheck?: { passed?: boolean; issues?: string[] };
    tailoredCv?: unknown;
  };
  if (preparedMaterials.factCheck?.passed !== true)
    return jsonError(
      "The tailored CV failed the fact check. Review its highlighted issues and prepare a corrected CV before sending.",
      409,
    );
  const job = mapJobRow(row);
  const recipientEmail = typedEmail || job.applyEmail;
  const fresh = RawJob.safeParse({
    title: job.title,
    company: job.company,
    city: job.city,
    remote: job.remote,
    description: job.description,
    applyUrl: job.applyUrl,
    applyEmail: job.applyEmail,
    postedAt: row.posted_at,
    validThrough: row.valid_through,
    source: job.source,
    trustTier: job.tier,
    sourceUrl: job.sourceUrl,
    applyMethod: job.applyMethod,
  });
  if (!fresh.success)
    return jsonError(
      "The stored job record is incomplete and cannot be approved",
      409,
    );
  const report = await verifyJob(fresh.data);
  sqlite
    .prepare(
      "UPDATE jobs SET verification_status=?,verification_score=?,verification_report_json=?,verified_at=? WHERE id=?",
    )
    .run(
      report.status,
      report.score,
      JSON.stringify(report),
      new Date().toISOString(),
      row.application_job_id,
    );
  if (report.hardRuleHit || report.status === "rejected")
    return jsonError(
      `Application blocked by verification: ${report.reasoning}`,
      409,
    );
  // Reaching this endpoint is the user's explicit human approval. A listing
  // that remains in needs_review can therefore proceed after that approval;
  // hard scam rules and an explicit rejected result remain blocking above.
  if (row.apply_email) {
    const live = await checkListingOpen(job.applyUrl);
    if (live === false) {
      sqlite.prepare("UPDATE jobs SET status='closed' WHERE id=?").run(row.id);
      return jsonError(
        "The employer ATS no longer lists this job. The posting was marked closed.",
        409,
      );
    }
    if (live !== true)
      return jsonError(
        "The posting could not be rechecked through a supported ATS API. Do not email automatically; submit manually from the employer link.",
        409,
      );
  }
  const profileRow = sqlite
    .prepare(
      "SELECT parsed_json,preferences_json,cv_path,settings_json FROM profile WHERE id=?",
    )
    .get(profileId) as {
    parsed_json: string;
    preferences_json: string;
    cv_path: string | null;
    settings_json: string;
  };
  const profile = ParsedCv.parse(JSON.parse(profileRow.parsed_json));
  const coverLetter = ensureCoverLetterSignature(
    editedCoverLetter || String(row.application_cover_letter || ""),
    profile.name,
  );
  sqlite
    .prepare("UPDATE applications SET cover_letter=? WHERE id=?")
    .run(coverLetter, row.application_id);
  const settings = Settings.parse(JSON.parse(profileRow.settings_json));
  const preferences = Preferences.parse(
    JSON.parse(profileRow.preferences_json),
  );
  if (Number(row.match_score) < preferences.minMatch)
    return jsonError("The job is below your current minimum match score", 409);
  if (
    preferences.excludedCompanies.some((name) =>
      job.company.toLowerCase().includes(name.toLowerCase()),
    )
  )
    return jsonError("This company is excluded in your preferences", 409);
  if (
    preferences.excludedKeywords.some((word) =>
      `${job.title} ${String(job.description)}`
        .toLowerCase()
        .includes(word.toLowerCase()),
    )
  )
    return jsonError("This posting matches an excluded keyword", 409);
  const lagosDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Lagos",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const lagosMidnight = new Date(`${lagosDate}T00:00:00+01:00`).toISOString();
  const sentToday = (
    sqlite
      .prepare(
        "SELECT count(*) AS n FROM applications WHERE status='sent' AND sent_at>=?",
      )
      .get(lagosMidnight) as { n: number }
  ).n;
  if (sentToday >= settings.dailyCap)
    return jsonError("Daily application cap reached", 429);
  const cooldown = new Date(
    Date.now() - settings.companyCooldownDays * 86400000,
  ).toISOString();
  const recent = sqlite
    .prepare(
      "SELECT count(*) AS n FROM applications a JOIN jobs j ON j.id=a.job_id WHERE lower(j.company_name)=lower(?) AND a.status='sent' AND a.sent_at>=?",
    )
    .get(job.company, cooldown) as { n: number };
  if (recent.n) return jsonError("Company cooldown is active", 409);
  const timestamp = new Date().toISOString();
  const events = Events.parse(
    JSON.parse(String(row.application_events_json || "[]")),
  );
  if (
    !recipientEmail ||
    !process.env.SMTP_HOST ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    !profile.email ||
    !profileRow.cv_path ||
    !row.application_cv_path
  ) {
    events.push({
      at: timestamp,
      event: "approved_handoff",
      message:
        "Approved; send settings or an email application route is missing, so this is ready for manual submission.",
    });
    sqlite
      .prepare(
        "UPDATE applications SET status='manual_required',events_json=? WHERE id=?",
      )
      .run(JSON.stringify(events), row.application_id);
    return NextResponse.json({
      status: "manual_required",
      applyUrl: job.applyUrl,
      coverLetter,
      message:
        "No email was sent. Open the employer application link and use the prepared letter and your saved CV.",
    });
  }
  try {
    // Rebuild with the current ATS-friendly layout so applications prepared
    // before this layout update also receive the corrected PDF.
    const savedTailoredCv = TailoredCv.safeParse(preparedMaterials.tailoredCv);
    const attachmentPath = await writeCvPdf(
      profile,
      savedTailoredCv.success ? savedTailoredCv.data : originalCvView(profile),
    );
    sqlite
      .prepare("UPDATE applications SET tailored_cv_path=? WHERE id=?")
      .run(attachmentPath, row.application_id);
    const nodemailer = require("nodemailer") as {
      createTransport: (options: Record<string, unknown>) => {
        sendMail: (
          message: Record<string, unknown>,
        ) => Promise<{ messageId: string }>;
      };
    };
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    const configuredFrom = process.env.SMTP_FROM?.trim() || process.env.SMTP_USER || "";
    const configuredAddress = configuredFrom.match(/<([^>]+)>/)?.[1]?.trim() || (configuredFrom.includes("@") ? configuredFrom : process.env.SMTP_USER || "");
    const configuredName = configuredFrom.match(/^\s*[\"']?([^<>\"']+?)[\"']?\s*<[^>]+>\s*$/)?.[1]?.trim() || "";
    const displayName = settings.emailDisplayName.trim() || configuredName;
    const message = {
      from: configuredAddress ? { name: displayName || undefined, address: configuredAddress } : configuredFrom,
      to: recipientEmail,
      replyTo: profile.email,
      subject: `Application: ${job.title} — ${profile.name || "Applicant"}`,
      text: coverLetter,
      attachments: [
        {
          filename: `${(profile.name || "Applicant").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim() || "Applicant"} CV.pdf`,
          path: attachmentPath,
          contentType: "application/pdf",
        },
      ],
    };
    let sent: { messageId: string } | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        sent = await transport.sendMail(message);
        break;
      } catch (e) {
        if (attempt === 1) throw e;
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    events.push({
      at: timestamp,
      event: "sent",
      message: `Email application sent to ${recipientEmail} (${sent?.messageId || "accepted by SMTP"}).`,
    });
    sqlite
      .prepare(
        "UPDATE applications SET status='sent',sent_at=?,events_json=?,error=NULL WHERE id=?",
      )
      .run(timestamp, JSON.stringify(events), row.application_id);
    return NextResponse.json({ status: "sent", sentAt: timestamp });
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMTP send failed";
    events.push({ at: timestamp, event: "send_failed", message });
    sqlite
      .prepare(
        "UPDATE applications SET status='queued',error=?,events_json=? WHERE id=?",
      )
      .run(message, JSON.stringify(events), row.application_id);
    return jsonError(
      `SMTP send failed after one retry: ${message}. Check mail settings, then approve again to retry.`,
      502,
    );
  }
}
