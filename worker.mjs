import cron from "node-cron";

const appUrl = process.env.APP_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;
const timezone = "Africa/Lagos";
const requestTimeout = 5 * 60 * 1000;

if (!cronSecret) {
  console.error("CRON_SECRET is required for the background worker.");
  process.exit(1);
}

const running = new Set();
let stopping = false;

async function callApi(path, label, { method = "POST", profileId, attempts = 3, timeout = requestTimeout } = {}) {
  const response = await fetch(new URL(path, appUrl), {
    method,
    headers: {
      Authorization: `Bearer ${cronSecret}`,
      "Content-Type": "application/json",
      "User-Agent": "JobFinder-Worker/1.0 (+self-hosted background worker)",
      ...(profileId ? { "x-worker-profile-id": profileId } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `${label} returned ${response.status}`);
  return result;
}

async function runTask(name, task) {
  if (stopping || running.has(name)) {
    if (running.has(name)) console.warn(`[worker] ${name} skipped because it is already running`);
    return;
  }
  running.add(name);
  try {
    for (let attempt = 1; attempt <= (task.attempts || 3); attempt++) {
      try {
        const result = await task.run();
        console.info(`[worker] ${name} completed: ${JSON.stringify(result?.summary || result || {})}`);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === (task.attempts || 3)) throw error;
        const delay = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
        console.error(`[worker] ${name} attempt ${attempt} failed: ${message}; retrying in ${delay / 1000}s`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } catch (error) {
    console.error(`[worker] ${name} failed:`, error instanceof Error ? error.message : error);
  } finally {
    running.delete(name);
  }
}

async function discoverForAllUsers() {
  const { profiles } = await callApi("/api/worker/profiles", "profiles", { method: "GET", attempts: 1, timeout: 30_000 });
  const summaries = [];
  for (const profileId of profiles || []) {
    const result = await callApi("/api/jobs/search", "discovery", { profileId });
    summaries.push({ profileId, summary: result.summary });
  }
  return { profiles: summaries.length, summaries };
}

cron.schedule("0 7,19 * * *", () => void runTask("discovery", { run: discoverForAllUsers }), { timezone });
cron.schedule("0 3 */2 * *", () => void runTask("reverification", { run: () => callApi("/api/jobs/reverify", "reverification") }), { timezone });

console.info(`[worker] scheduled discovery at 07:00 and 19:00, plus re-verification every 48 hours at 03:00 (${timezone})`);
console.info(`[worker] API: ${appUrl}`);

if (process.env.WORKER_RUN_ON_START === "true") void runTask("startup discovery", { run: discoverForAllUsers });

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.info(`[worker] ${signal} received; waiting for ${running.size} active task(s)`);
  const waitForTasks = setInterval(() => {
    if (!running.size) {
      clearInterval(waitForTasks);
      process.exit(0);
    }
  }, 250);
  setTimeout(() => process.exit(1), requestTimeout + 5_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
