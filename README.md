# Job Finder

A local-first, single-user job discovery and application tracker built from [`plan.md`](./plan.md). It uses Next.js route handlers, SQLite, Drizzle, Zod, and OpenRouter. Use Node.js 22.5 or newer for the built-in SQLite module.

## Set up

```bash
npm install
cp .env.example .env.local
```

Set `APP_PASSWORD` and a long random `AUTH_SECRET` before exposing the app beyond a trusted development machine. Add an OpenRouter key and model IDs to enable CV parsing, job review, match scoring, and letter generation. SMTP is optional; without it, approvals become manual handoffs. Keep `.env.local` private.

Then start the web app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The first search requires a reviewed profile and at least one public Greenhouse or Lever board in Profile & Settings. Add one per line in this format:

```text
Company name|greenhouse|board-slug
Company name|lever|site-slug
```

Scheduled discovery and re-verification run in a separate process and require the web app to be running. Set `CRON_SECRET`, then start the worker:

```bash
npm run worker
```

It calls the authenticated search route twice daily and re-verifies stale open jobs every 48 hours in the `Africa/Lagos` timezone. Set `WORKER_RUN_ON_START=true` if you want discovery to run immediately when the worker starts. Manual search is available from the Jobs page.

## Implemented workflows

- Profile and preference data persist in SQLite; jobs, verification reports, runs, tasks, AI call usage, and application history use local tables.
- CV upload accepts PDF files up to 10 MB, checks the PDF signature, extracts text, calls OpenRouter for Zod-validated profile and search-target JSON, and stores the source file under `CV_DIR` with restrictive permissions. Scanned PDFs currently return an explicit unsupported OCR message.
- Discovery calls public Greenhouse and Lever board APIs from the configured watchlist, normalizes and deduplicates records, and stores them with FTS5 keyword search.
- Deterministic scam rules run before AI review. Tier C is capped at `needs_review`; hard scam signals reject. Match scoring uses the profile and preferences, with AI scoring when configured.
- Paste-a-link safely fetches public HTTPS pages with DNS pinning, redirect checks, and a 2 MB cap, then extracts job fields through the structured AI schema. Contacts are discarded unless present in the page. Tier C leads always require review; login-only social pages may not be readable.
- Application preparation creates a job-tailored CV PDF using only supplied profile facts, checks listed skills/employers/titles/dates/education/certifications and numeric claims, and stores an original-versus-tailored preview with the cover letter. A failed fact check blocks sending. Approval rechecks the job, live ATS status, daily cap, and company cooldown. Configured email applications attach the checked tailored CV and are sent only after explicit human approval. Other applications become manual handoffs.
- Level 1/2 autopilot remains server-locked at Level 0 until the evaluation harness and its pass gate are implemented.

## Still outstanding from the plan

This is a functional foundation, not every phase of the full automation plan. Remaining work includes additional source adapters and alert inbox polling; extraction from plain social/alert text; company domain verification and tier upgrades; deeper semantic checks for rewritten CV bullets; supported ATS form automation; a labeled AI eval set and Autopilot gate; richer run progress and notifications; and complete migration/backup tooling. Do not enable unattended sending until those gates exist and have passed against reviewed data.

SQLite and CV files must live on persistent local or VPS storage. This project is not intended for Vercel's ephemeral filesystem. See [`plan.md`](./plan.md) for the complete requirements and safety rules.

## Environment variables

Copy [.env.example](./.env.example) to `.env.local`. Database and CV paths default to `./data/app.db` and `./data/cvs/`; these local data files are ignored by Git. Configure model IDs from the current OpenRouter model catalog rather than relying on a hard-coded model name.

## Scripts

```bash
npm run dev    # Next.js development server
npm run build  # production build
npm start      # production server
npm run worker # twice-daily discovery scheduler
npm run lint   # ESLint
```
# job-finder
# job-finder
