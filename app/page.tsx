"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { usePathname, useRouter } from "next/navigation";

type Job = {
  id: string;
  title: string;
  company: string;
  city: string | null;
  remote: string;
  description: string;
  source: string;
  tier: string;
  applyUrl: string | null;
  applyEmail: string | null;
  applyMethod: string;
  postedAt: string | null;
  validThrough: string | null;
  sourceUrl: string | null;
  verificationStatus: string;
  verificationScore: number;
  verificationReport: {
    reasoning?: string;
    hardRuleHit?: string | null;
    checks?: Record<string, boolean>;
  };
  matchScore: number;
  matchReasons: string[];
  saved: boolean;
};
type Profile = {
  name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  summary: string | null;
  skills: string[];
  experience: {
    company: string;
    title: string;
    start: string | null;
    end: string | null;
    bullets: string[];
  }[];
  education: {
    institution: string;
    degree: string | null;
    year: string | null;
  }[];
  certifications: string[];
};
type Prefs = {
  titles: string[];
  cities: string[];
  remote: boolean;
  salaryFloor: number | null;
  excludedCompanies: string[];
  excludedKeywords: string[];
  companyWatchlist: {
    name: string;
    ats: "greenhouse" | "lever";
    slug: string;
  }[];
  minMatch: number;
  autoMatch: number;
};
type Settings = {
  autopilotLevel: number;
  dailyCap: number;
  companyCooldownDays: number;
  perRunBudgetUsd: number;
  aiProvider: "openrouter" | "openai" | "groq";
  aiModel: string;
  emailDisplayName: string;
  models: Record<string, string>;
};
type Application = {
  id: string;
  jobId: string;
  title: string;
  company: string;
  city: string | null;
  status: string;
  method: string;
  coverLetter: string | null;
  originalCv: Profile | null;
  tailoredCv: {
    summary: string;
    skills: string[];
    experience: Profile["experience"];
    education: Profile["education"];
    certifications: string[];
  } | null;
  factCheck: { passed: boolean; issues: string[] };
  createdAt: string;
  sentAt: string | null;
  error: string | null;
  events: { at: string; event: string; message: string }[];
  verificationStatus: string;
  matchScore: number;
  applyUrl: string | null;
  applyEmail: string | null;
};
type Account = { id: string; name: string; email: string | null };

const emptyProfile: Profile = {
  name: "",
  email: null,
  phone: null,
  location: null,
  summary: null,
  skills: [],
  experience: [],
  education: [],
  certifications: [],
};
const emptyPrefs: Prefs = {
  titles: [],
  cities: [],
  remote: true,
  salaryFloor: null,
  excludedCompanies: [],
  excludedKeywords: [],
  companyWatchlist: [],
  minMatch: 0.5,
  autoMatch: 0.75,
};
const icons: Record<string, string> = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z",
  briefcase: "M3 7h18v14H3z M8 7V4h8v3 M3 12h18 M10 12v2h4",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M19 13a7 7 0 0 0-.2-1.6l1.5-1.1-1.5-2.6-1.8.6a7 7 0 0 0-2.8-1.6L14 5h-3l-.3 1.8a7 7 0 0 0-2.8 1.6l-1.8-.6-1.5 2.6 1.5 1.1A7 7 0 0 0 6 13l-1.5 1.1L6 16.7l1.8-.6a7 7 0 0 0 2.8 1.6L11 19.5h3l.3-1.8a7 7 0 0 0 2.8-1.6l1.8.6 1.5-2.6L19 13z",
  search: "M20 20l-4.5-4.5 M18 10.5a7.5 7.5 0 1 1-15 0 7.5 7.5 0 0 1 15 0z",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  spark: "m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z",
  check: "m5 12 4 4L19 6",
  link: "M10 13a5 5 0 0 0 7 .5l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7",
  close: "M18 6 6 18 M6 6l12 12",
  upload: "M12 16V4 M7 9l5-5 5 5 M4 20h16",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[name] || icons.grid} />
    </svg>
  );
}

async function api<T = Record<string, unknown>>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.error || `Request failed (${response.status})`),
      { status: response.status },
    );
  return data as T;
}
const asList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
const parseModels = (source: string): Record<string,string> => Object.fromEntries(source.split("\n").flatMap((line) => { const splitAt=line.indexOf("="); if(splitAt<1)return []; const key=line.slice(0,splitAt).trim(); const value=line.slice(splitAt+1).trim(); return key&&value?[[key,value] as [string,string]]:[]; }));

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const page = pathname.startsWith("/applications")
    ? "Applications"
    : pathname.startsWith("/settings")
      ? "Profile & settings"
      : "Jobs";
  const navigate = (destination: "Jobs" | "Applications" | "Profile & settings") => {
    router.push(destination === "Jobs" ? "/jobs" : destination === "Applications" ? "/applications" : "/settings");
  };
  const [jobs, setJobs] = useState<Job[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [profile, setProfile] = useState<Profile>(emptyProfile);
  const [preferences, setPreferences] = useState<Prefs>(emptyPrefs);
  const [settings, setSettings] = useState<Settings>({
    autopilotLevel: 0,
    dailyCap: 5,
    companyCooldownDays: 30,
    perRunBudgetUsd: 1,
    aiProvider: "openrouter",
    aiModel: "",
    emailDisplayName: "",
    models: {},
  });
  const [integrations, setIntegrations] = useState({
    openRouter: false,
    openai: false,
    groq: false,
    smtp: false,
    webSearch: false,
    xSearch: false,
  });
  const [aiConnectionChecks, setAiConnectionChecks] = useState<Record<Settings["aiProvider"], string>>({
    openrouter: "Not tested",
    openai: "Not tested",
    groq: "Not tested",
  });
  const [filter, setFilter] = useState("All jobs");
  const [jobSort, setJobSort] = useState("recent");
  const [query, setQuery] = useState("");
  const [link, setLink] = useState("");
  const [watchlist, setWatchlist] = useState("");
  const [modelConfig, setModelConfig] = useState("");
  const [selected, setSelected] = useState<Job | null>(null);
  const [reviewApp, setReviewApp] = useState<Application | null>(null);
  const [recruiterEmail, setRecruiterEmail] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authName, setAuthName] = useState("");
  const [authEmail, setAuthEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [runSummary, setRunSummary] = useState("");
  const [tab, setTab] = useState("Discover");
  const flash = useCallback((message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 4500);
  }, []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [auth, p, j, a] = await Promise.all([
        api<{ authenticated: boolean; user: Account | null }>("/api/auth"),
        api<{
          profile: Profile;
          preferences: Prefs;
          settings: Settings;
          integrations: { openRouter: boolean; openai: boolean; groq: boolean; smtp: boolean; webSearch: boolean; xSearch: boolean };
          cvUploaded: boolean;
          searchTargets: { titles: string[]; keywords: string[] };
        }>("/api/profile"),
        api<{ jobs: Job[] }>(`/api/jobs?sort=${jobSort}`),
        api<{ applications: Application[] }>("/api/applications"),
      ]);
      setAccount(auth.user);
      setProfile(p.profile);
      setPreferences(p.preferences);
      setSettings(p.settings);
      setModelConfig(Object.entries(p.settings.models || {}).map(([task, model]) => `${task}=${model}`).join("\n"));
      setIntegrations(p.integrations);
      setWatchlist(
        p.preferences.companyWatchlist
          .map((x) => `${x.name}|${x.ats}|${x.slug}`)
          .join("\n"),
      );
      setJobs(j.jobs);
      setApplications(a.applications);
      setAuthenticated(true);
      setAuthRequired(false);
    } catch (e) {
      if ((e as { status?: number }).status === 401) {
        setAuthRequired(true);
        setAuthenticated(false);
      } else
        flash(e instanceof Error ? e.message : "Could not load saved data");
    } finally {
      setLoading(false);
    }
  }, [flash, jobSort]);
  useEffect(() => {
    void load();
  }, [load]);
  const visible = useMemo(
    () =>
      jobs.filter(
        (j) =>
          (filter === "All jobs" ||
            (filter === "Verified"
              ? j.verificationStatus === "verified"
              : filter === "Rejected"
                ? j.verificationStatus === "rejected"
                : j.verificationStatus === "needs_review")) &&
          `${j.title} ${j.company} ${j.city || ""}`
            .toLowerCase()
            .includes(query.toLowerCase()),
      ),
    [jobs, filter, query],
  );
  const runSearch = async () => {
    setBusy(true);
    try {
      const result = await api<{
        runId: string;
        summary: {
          found: number;
          processed: number;
          new: number;
          verified: number;
          rejected: number;
          errors: string[];
        };
      }>("/api/jobs/search", { method: "POST", body: JSON.stringify({}) });
      setRunSummary(
        `${result.summary.processed} processed · ${result.summary.new} new · ${result.summary.errors.length} source errors`,
      );
      flash(`Search complete · ${result.summary.new} new jobs`);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  };
  const clearAllJobs = async () => {
    const confirmed = window.confirm(
      "Clear every job and its saved application history? This permanently deletes job listings, saved jobs, applications, and generated tailored CV PDFs. Your profile and uploaded original CV will remain.",
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      const result = await api<{ deletedJobs: number; deletedApplications: number }>(
        "/api/jobs",
        { method: "DELETE" },
      );
      setRunSummary("");
      await load();
      flash(`Cleared ${result.deletedJobs} jobs and ${result.deletedApplications} application records`);
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not clear jobs");
    } finally {
      setBusy(false);
    }
  };
  const addLink = async () => {
    if (!link.trim()) return;
    setBusy(true);
    try {
      const result = await api<{ message: string }>("/api/jobs/link", {
        method: "POST",
        body: JSON.stringify({ url: link.trim() }),
      });
      setLink("");
      flash(result.message);
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not add link");
    } finally {
      setBusy(false);
    }
  };
  const saveProfile = async () => {
    setBusy(true);
    try {
      const parsedWatchlist = watchlist
        .split("\n")
        .map((line) => line.split("|").map((s) => s.trim()))
        .filter(
          (x) =>
            x.length === 3 &&
            x[0] &&
            x[2] &&
            (x[1] === "greenhouse" || x[1] === "lever"),
        )
        .map(([name, ats, slug]) => ({
          name,
          ats: ats as "greenhouse" | "lever",
          slug,
        }));
      const nextPrefs = { ...preferences, companyWatchlist: parsedWatchlist };
      const nextSettings = { ...settings, autopilotLevel: 0, models: parseModels(modelConfig) };
      await api("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ profile, preferences: nextPrefs, settings: nextSettings }),
      });
      setPreferences(nextPrefs);
      setSettings(nextSettings);
      flash("Profile and settings saved");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not save settings");
    } finally {
      setBusy(false);
    }
  };
  const checkAiProvider = async (provider: Settings["aiProvider"]) => {
    setAiConnectionChecks((current) => ({ ...current, [provider]: "Checking…" }));
    try {
      const result = await api<{ model: string }>("/api/ai/check", {
        method: "POST",
        body: JSON.stringify({ provider, model: settings.aiProvider === provider ? settings.aiModel : "" }),
      });
      setAiConnectionChecks((current) => ({ ...current, [provider]: `Connected · ${result.model}` }));
    } catch (e) {
      const message = e instanceof Error ? e.message : "Connection check failed";
      setAiConnectionChecks((current) => ({ ...current, [provider]: message }));
    }
  };
  const uploadCv = async (file?: File) => {
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api<{
        profile: Profile;
        searchTargets: { titles: string[]; keywords: string[] };
      }>("/api/profile/cv", { method: "POST", body: form });
      setProfile(result.profile);
      setPreferences((p) => ({
        ...p,
        titles: result.searchTargets.titles.length
          ? result.searchTargets.titles
          : p.titles,
      }));
      flash("CV analyzed. Review the extracted profile and save it.");
    } catch (e) {
      flash(e instanceof Error ? e.message : "CV upload failed");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };
  const prepare = async (job: Job) => {
    setBusy(true);
    try {
      const result = await api<{ application: { id: string; status: string } }>(
        "/api/applications",
        { method: "POST", body: JSON.stringify({ jobId: job.id }) },
      );
      flash(
        `Application prepared · ${result.application.status.replaceAll("_", " ")}`,
      );
      setSelected(null);
      await load();
      navigate("Applications");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not prepare application");
    } finally {
      setBusy(false);
    }
  };
  const saveJob = async (job: Job) => {
    try {
      await api(`/api/jobs/${job.id}/save`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not save job");
    }
  };
  const verify = async (job: Job) => {
    setBusy(true);
    try {
      const result = await api<{ verification: { score: number; status: string; hardRuleHit: string | null; checks: Record<string, boolean>; reasoning: string } }>(`/api/jobs/${job.id}/verify`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await load();
      setSelected((s) => s?.id === job.id ? {
        ...s,
        verificationStatus: result.verification.status,
        verificationScore: result.verification.score,
        verificationReport: result.verification,
      } : s);
      flash("Verification report refreshed");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };
  const approve = async (app: Application, email: string): Promise<string | null> => {
    setBusy(true);
    try {
      const result = await api<{ status: string; message?: string }>(
        `/api/applications/${app.id}/approve`,
        {
          method: "POST",
          body: JSON.stringify({
            recruiterEmail: email.trim(),
            coverLetter: app.coverLetter || "",
          }),
        },
      );
      flash(
        result.status === "sent"
          ? "Application sent successfully"
          : result.message || "Application is ready for manual submission",
      );
      await load();
      return result.status;
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not approve application");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const replaceWithOriginalCv=async(app:Application)=>{setBusy(true);try{const result=await api<{tailoredCv:NonNullable<Application["tailoredCv"]>;factCheck:Application["factCheck"];coverLetter:string;message:string}>(`/api/applications/${app.id}/regenerate`,{method:"POST",body:JSON.stringify({})});setReviewApp(current=>current?{...current,tailoredCv:result.tailoredCv,factCheck:result.factCheck,coverLetter:result.coverLetter,status:"queued",error:null}:current);flash(result.message);await load()}catch(e){flash(e instanceof Error?e.message:"Could not replace the tailored CV")}finally{setBusy(false)}};
  const login = async () => {
    setBusy(true);
    try {
      await api("/api/auth", {
        method: "POST",
        body: JSON.stringify({ action: authMode, ...(authMode === "register" ? { name: authName.trim() } : {}), ...(authEmail.trim() ? { email: authEmail.trim() } : {}), password }),
      });
      setAuthenticated(true);
      setAuthRequired(false);
      const session = await api<{ user: Account | null }>("/api/auth");
      setAccount(session.user);
      setAuthMode("login");
      setAuthName("");
      setAuthEmail("");
      setPassword("");
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };
  const logout = async () => {
    setBusy(true);
    try {
      await api("/api/auth", { method: "DELETE" });
      setAccount(null);
      setAuthenticated(false);
      setAuthRequired(true);
      setPassword("");
      setAuthEmail("");
      setAuthName("");
      setAuthMode("login");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not log out");
    } finally {
      setBusy(false);
    }
  };
  const updateProfile = (key: keyof Profile, value: unknown) =>
    setProfile((p) => ({ ...p, [key]: value }) as Profile);
  if (authRequired && !authenticated)
    return (
      <main className="auth-screen">
        <div className="auth-card">
          <a className="brand">
            <span className="brand-icon">J</span>
            <span>
              job<span className="brand-muted">finder</span>
            </span>
          </a>
          <h1>{authMode === "login" ? "Welcome back" : "Create your account"}</h1>
          <p>{authMode === "login" ? "Sign in to your private job finder workspace." : "Create an account to save your profile and opportunities."}</p>
          {authMode === "register" && <label>
            Name
            <input type="text" autoComplete="name" value={authName} onChange={(e) => setAuthName(e.target.value)} />
          </label>}
          <label>
            Email
            <input type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
          </label>
          <label>
            Password
            <input
              type="password"
              autoComplete={authMode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && login()}
            />
          </label>
          <button className="button primary" disabled={busy} onClick={login}>
            {busy ? (authMode === "login" ? "Signing in…" : "Creating account…") : authMode === "login" ? "Sign in" : "Create account"}
          </button>
          <button className="auth-switch" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
            {authMode === "login" ? "Need an account? Create one" : "Already have an account? Sign in"}
          </button>
        </div>
        {notice && <div className="toast">{notice}</div>}
      </main>
    );
  const verifiedCount = jobs.filter(
    (j) => j.verificationStatus === "verified",
  ).length;
  const savedCount = jobs.filter((j) => j.saved).length;
  const pending = applications.filter((a) =>
    ["queued", "approved"].includes(a.status),
  ).length;
  return (
    <main className="shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#home"
          onClick={(e) => {
            e.preventDefault();
            navigate("Jobs");
          }}
        >
          <span className="brand-icon">J</span>
          <span>
            job<span className="brand-muted">finder</span>
          </span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button
            className={page === "Jobs" ? "active" : ""}
            onClick={() => navigate("Jobs")}
          >
            <Icon name="grid" />
            <span>Jobs</span>
            <span className="nav-count">{jobs.length}</span>
          </button>
          <button
            className={page === "Applications" ? "active" : ""}
            onClick={() => navigate("Applications")}
          >
            <Icon name="briefcase" />
            <span>Applications</span>
            <span className="nav-count">{applications.length}</span>
          </button>
          <button
            className={page === "Profile & settings" ? "active" : ""}
            onClick={() => navigate("Profile & settings")}
          >
            <Icon name="settings" />
            <span>Profile & settings</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="autopilot-card">
            <div className="autopilot-head">
              <span className="pulse" />
              <span>Autopilot</span>
              <span className="level-tag">LEVEL 0</span>
            </div>
            <p>
              Autopilot is locked until the safety evaluation gate is
              implemented and passed.
            </p>
            <button onClick={() => navigate("Profile & settings")}>
              Configure <Icon name="arrow" size={14} />
            </button>
          </div>
          <div className="user-row">
            <div className="avatar">
              {(account?.name || profile.name || "JD")
                .split(/\s+/)
                .slice(0, 2)
                .map((x) => x[0])
                .join("")
                .toUpperCase()}
            </div>
            <div>
              <strong>{account?.name || profile.name || "Your profile"}</strong>
              <small>{account?.email || profile.email || "Personal workspace"}</small>
            </div>
            <button
              className="user-logout"
              disabled={busy}
              onClick={() => void logout()}
            >
              Log out
            </button>
          </div>
        </div>
      </aside>
      <section className="main-area">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <span>/</span> <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <div className="system-status">
              <span className="status-dot" /> Local data connected
            </div>
            <button
              className="icon-button"
              aria-label="Reload"
              onClick={() => load()}
            >
              <Icon name="bell" />
            </button>
            <div className="avatar small">
              {(account?.name || profile.name) ? (account?.name || profile.name)[0].toUpperCase() : "JD"}
            </div>
          </div>
        </header>
        {page === "Jobs" ? (
          <div className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">YOUR NEXT MOVE STARTS HERE</div>
                <h1>Find your next opportunity</h1>
                <p className="subheading">
                  Roles discovered from your configured employer career pages.
                </p>
              </div>
              <div className="page-heading-actions">
                <button
                  className="button secondary danger"
                  onClick={clearAllJobs}
                  disabled={busy}
                >
                  Clear all jobs
                </button>
                <button
                  className="button primary"
                  onClick={runSearch}
                  disabled={busy}
                >
                  <Icon name="search" size={16} />
                  {busy ? "Working…" : "Run search"}
                </button>
              </div>
            </div>
            <div className="metrics">
              <div className="metric-card">
                <span className="metric-icon purple">
                  <Icon name="search" size={17} />
                </span>
                <div>
                  <small>Open jobs</small>
                  <strong>{jobs.length}</strong>
                  <span className="metric-note">{savedCount} saved</span>
                </div>
                <div className="sparkline">
                  {jobs.length ? "▁▃▂▅▄▆▅█" : "—"}
                </div>
              </div>
              <div className="metric-card">
                <span className="metric-icon green">
                  <Icon name="check" size={17} />
                </span>
                <div>
                  <small>Verified jobs</small>
                  <strong>{verifiedCount}</strong>
                  <span className="metric-note">Tier A/B checks</span>
                </div>
                <div className="ring">
                  {jobs.length
                    ? Math.round((verifiedCount / jobs.length) * 100)
                    : 0}
                  %
                </div>
              </div>
              <div className="metric-card">
                <span className="metric-icon amber">
                  <Icon name="briefcase" size={17} />
                </span>
                <div>
                  <small>Applications</small>
                  <strong>{applications.length}</strong>
                  <span className="metric-note">{pending} awaiting review</span>
                </div>
                <div className="metric-arrow">↗</div>
              </div>
            </div>
            <div className="search-strip">
              <span className="search-symbol">
                <Icon name="search" />
              </span>
              <div className="search-copy">
                <strong>
                  {runSummary ||
                    "Searches for Nigeria eligible full stack roles matched to your skills"}
                </strong>
                <span>
                  {preferences.companyWatchlist.length
                    ? `${preferences.companyWatchlist.length} employer boards configured`
                    : "Nigeria based and Nigeria eligible remote roles are searched automatically; employer boards are optional."}
                </span>
              </div>
              <button
                className="text-button"
                onClick={runSearch}
                disabled={busy}
              >
                Run now <Icon name="arrow" size={14} />
              </button>
              <span className="strip-divider" />
              <span className="source-count">
                {preferences.companyWatchlist.length} active
              </span>
            </div>
            <div className="section-title-row">
              <div>
                <h2>Recommended opportunities</h2>
                <span className="results-count">
                  Saved in your local SQLite database
                </span>
              </div>
              <div className="view-tabs">
                <button
                  className="selected"
                  onClick={() => {
                    navigate("Jobs");
                    setTab("Discover");
                  }}
                >
                  Discover
                </button>
                <button onClick={() => navigate("Applications")}>
                  Applications <span>{applications.length}</span>
                </button>
              </div>
            </div>
            <div className="filter-row">
              <div className="filter-pills">
                {["All jobs", "Verified", "Needs review", "Rejected"].map((f) => (
                  <button
                    key={f}
                    className={filter === f ? "filter active-filter" : "filter"}
                    onClick={() => setFilter(f)}
                  >
                    {f}
                    {f === "All jobs" && <span>{jobs.length}</span>}
                  </button>
                ))}
              </div>
              <label className="inline-search">
                <Icon name="search" size={15} />
                <input
                  placeholder="Search title or company"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                className="sort-button"
                value={jobSort}
                onChange={(e) => setJobSort(e.target.value)}
                aria-label="Sort jobs"
              >
                <option value="recent">Most recent</option>
                <option value="score">Best match</option>
              </select>
            </div>
            <div className="job-list">
              {loading ? (
                <div className="empty-state">Loading saved jobs…</div>
              ) : (
                visible.map((job, i) => (
                  <article className="job-card" key={job.id}>
                    <button
                      className="job-main"
                      onClick={() => setSelected(job)}
                    >
                      <div className={`company-logo logo-${i % 4}`}>
                        {job.company.slice(0, 1).toUpperCase()}
                      </div>
                      <div className="job-info">
                        <div className="job-title-line">
                          <h3>{job.title}</h3>
                          <span
                            className={`verify-badge ${job.verificationStatus === "verified" ? "verified" : job.verificationStatus === "rejected" ? "review" : "review"}`}
                          >
                            <span />
                            {job.verificationStatus.replaceAll("_", " ")}
                          </span>
                        </div>
                        <div className="company-line">
                          <strong>{job.company}</strong>
                          <span>·</span>
                          <span>{job.city || job.remote}</span>
                          <span>·</span>
                          <span>
                            {job.postedAt
                              ? new Date(job.postedAt).toLocaleDateString()
                              : "Date unknown"}
                          </span>
                        </div>
                        <div className="job-tags">
                          <span>{job.applyMethod}</span>
                          <span>{job.source.replaceAll("_", " ")}</span>
                          <span className="tier">Tier {job.tier}</span>
                        </div>
                      </div>
                      <div className="match-score">
                        <div
                          className="score-ring"
                          style={
                            {
                              "--score": `${Math.round(job.matchScore * 360)}deg`,
                            } as CSSProperties
                          }
                        >
                          <span>{Math.round(job.matchScore * 100)}</span>
                        </div>
                        <small>match</small>
                      </div>
                      <span className="chevron">›</span>
                    </button>
                    <div className="job-card-footer">
                      <span>
                        <Icon name="spark" size={14} />
                        {job.matchReasons[0] ||
                          job.verificationReport.reasoning ||
                          "Matched against your profile"}
                      </span>
                      <div>
                        <button
                          className="save-button"
                          onClick={() => void saveJob(job)}
                        >
                          {job.saved ? "♥ Saved" : "♡ Save"}
                        </button>
                        <button
                          className="view-button"
                          onClick={() => setSelected(job)}
                        >
                          Details <Icon name="arrow" size={13} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))
              )}
              {!loading && !visible.length && (
                <div className="empty-state">
                  {jobs.length
                    ? "No jobs match those filters."
                    : "No jobs yet. Add employer career board slugs in Profile & settings, then run a search. You can also paste a job link below."}
                </div>
              )}
            </div>
            <div className="paste-link-card">
              <div className="link-icon">
                <Icon name="link" />
              </div>
              <div className="paste-copy">
                <strong>Found a role somewhere else?</strong>
                <span>
                  Paste a public HTTPS job link. It will stay unverified until
                  reviewed.
                </span>
              </div>
              <input
                aria-label="Job posting URL"
                placeholder="https://company.com/careers/role"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLink()}
              />
              <button
                className="button secondary"
                onClick={addLink}
                disabled={busy}
              >
                Add link <Icon name="arrow" size={14} />
              </button>
            </div>
            <footer className="content-footer">
              <span>
                Showing {visible.length} of {jobs.length} stored jobs
              </span>
              <button onClick={load}>
                Refresh <Icon name="arrow" size={13} />
              </button>
            </footer>
          </div>
        ) : page === "Applications" ? (
          <div className="content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">STAY ON TOP OF EVERY OPPORTUNITY</div>
                <h1>Your applications</h1>
                <p className="subheading">
                  Prepared application records, review state, and sent history.
                </p>
              </div>
              <button className="button secondary" onClick={load}>
                Refresh
              </button>
            </div>
            <div className="application-summary">
              <div>
                <small>Total applications</small>
                <strong>{applications.length}</strong>
              </div>
              <div>
                <small>Awaiting review</small>
                <strong>
                  {applications.filter((a) => a.status === "queued").length}
                </strong>
              </div>
              <div>
                <small>Sent</small>
                <strong>
                  {applications.filter((a) => a.status === "sent").length}
                </strong>
              </div>
            </div>
            <div className="application-table">
              <div className="table-header">
                <span>ROLE & COMPANY</span>
                <span>STATUS</span>
                <span>CREATED</span>
                <span>METHOD / ACTION</span>
              </div>
              {applications.map((a) => (
                <div className="table-row" key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <small>
                      {a.company} {a.city ? `· ${a.city}` : ""}
                    </small>
                  </div>
                  <span className="table-status">
                    <i /> {a.status.replaceAll("_", " ")}
                  </span>
                  <span>{new Date(a.createdAt).toLocaleDateString()}</span>
                  <span>
                    {["queued", "approved", "failed", "manual_required"].includes(a.status) ? (
                      <button
                        className="view-button"
                        disabled={busy}
                        onClick={() => { setRecruiterEmail(""); setReviewApp(a); }}
                      >
                        {a.status === "manual_required" ? "Review manual application" : "Review & approve"} <Icon name="arrow" size={13} />
                      </button>
                    ) : (
                      <span>{a.method}</span>
                    )}
                  </span>
                  {a.error && <small className="table-error">{a.error}</small>}
                </div>
              ))}
              {!applications.length && (
                <div className="empty-state">
                  No application records yet. Prepare one from a job detail
                  view.
                </div>
              )}
            </div>
            <p className="settings-help">
              Approving may send an email if SMTP is configured and the job
              passes re-verification. Otherwise it stays available for manual
              submission. Browser navigation to employer forms is not automated.
            </p>
          </div>
        ) : (
          <div className="content settings-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">MAKE IT YOURS</div>
                <h1>Profile & settings</h1>
                <p className="subheading">
                  This saved profile drives matching and job discovery.
                </p>
              </div>
              <button
                className="button primary"
                onClick={saveProfile}
                disabled={busy}
              >
                Save changes
              </button>
            </div>
            <div className="settings-grid">
              <section className="settings-card">
                <div className="settings-card-heading">
                  <div>
                    <h2>Your CV & profile</h2>
                    <p>
                      CV facts are stored locally and used to prepare
                      applications.
                    </p>
                  </div>
                  <span className="complete-tag">
                    <Icon name="check" size={13} />
                    {profile.name ? "Profile loaded" : "Profile editable"}
                  </span>
                </div>
                <div className="cv-upload">
                  <div className="pdf-icon">PDF</div>
                  <div>
                    <strong>
                      {profile.name
                        ? `${profile.name}’s CV profile`
                        : "No CV uploaded"}
                    </strong>
                    <span>
                      {profile.skills.length
                        ? `${profile.skills.length} skills · ${profile.experience.length} experiences extracted`
                        : "Upload a text-based PDF to analyze it"}
                    </span>
                  </div>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    onChange={(e) => void uploadCv(e.target.files?.[0])}
                  />
                  <button
                    className="button secondary"
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Icon name="upload" size={14} />
                    {uploading ? "Analyzing…" : "Upload CV"}
                  </button>
                </div>
                <div className="profile-fields">
                  <label>
                    Full name
                    <input
                      value={profile.name}
                      onChange={(e) => updateProfile("name", e.target.value)}
                    />
                  </label>
                  <label>
                    Email address
                    <input
                      type="email"
                      value={profile.email || ""}
                      onChange={(e) =>
                        updateProfile("email", e.target.value || null)
                      }
                    />
                  </label>
                  <label>
                    Target job titles
                    <input
                      value={preferences.titles.join(", ")}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          titles: asList(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Preferred cities
                    <input
                      value={preferences.cities.join(", ")}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          cities: asList(e.target.value),
                        }))
                      }
                    />
                  </label>
                  <label>
                    Excluded companies
                    <input
                      value={preferences.excludedCompanies.join(", ")}
                      onChange={(e) => setPreferences((p) => ({ ...p, excludedCompanies: asList(e.target.value) }))}
                    />
                  </label>
                  <label>
                    Excluded keywords
                    <input
                      value={preferences.excludedKeywords.join(", ")}
                      onChange={(e) => setPreferences((p) => ({ ...p, excludedKeywords: asList(e.target.value) }))}
                    />
                  </label>
                  <label>
                    Skills
                    <textarea
                      value={profile.skills.join(", ")}
                      onChange={(e) =>
                        updateProfile("skills", asList(e.target.value))
                      }
                    />
                  </label>
                  <label>
                    Summary
                    <textarea
                      value={profile.summary || ""}
                      onChange={(e) =>
                        updateProfile("summary", e.target.value || null)
                      }
                    />
                  </label>
                  <label>
                    Minimum salary (NGN/month)
                    <input
                      type="number"
                      value={preferences.salaryFloor ?? ""}
                      onChange={(e) =>
                        setPreferences((p) => ({
                          ...p,
                          salaryFloor: e.target.value
                            ? Number(e.target.value)
                            : null,
                        }))
                      }
                    />
                  </label>
                </div>
                <h3 className="subsection-heading">Employer career boards</h3>
                <p className="settings-help">
                  One company board per line:{" "}
                  <code>Company name|greenhouse|board-slug</code> or{" "}
                  <code>Company name|lever|site-slug</code>. Only official ATS
                  public posting APIs are queried alongside public job feeds and Bluesky posts.
                </p>
                <textarea
                  className="watchlist-input"
                  value={watchlist}
                  onChange={(e) => setWatchlist(e.target.value)}
                  placeholder={
                    "Company|greenhouse|board-slug\nCompany|lever|site-slug"
                  }
                />
              </section>
              <section className="settings-card">
                <div className="settings-card-heading">
                  <div>
                    <h2>Application safety</h2>
                    <p>
                      Autopilot remains off until its evaluation gate is
                      implemented.
                    </p>
                  </div>
                </div>
                <label className="setting-label">
                  Autopilot level
                  <select value="0" disabled>
                    <option value="0">Review all (required)</option>
                  </select>
                </label>
                <div className="safety-note">
                  <span>
                    <Icon name="check" size={16} />
                  </span>
                  <p>
                    <strong>Review all is enforced</strong>
                    <br />
                    The server blocks automatic send. Explicitly approving a
                    prepared email application is still subject to fresh
                    verification, cooldown, and daily cap.
                  </p>
                </div>
                <label className="setting-label">
                  Daily application cap
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={settings.dailyCap}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        dailyCap: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="setting-label">
                  Company cooldown (days)
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={settings.companyCooldownDays}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        companyCooldownDays: Number(e.target.value),
                      }))
                    }
                  />
                </label>
                <label className="setting-label">
                  OpenRouter budget per search (USD)
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.05"
                    value={settings.perRunBudgetUsd}
                    onChange={(e) => setSettings((s) => ({ ...s, perRunBudgetUsd: Number(e.target.value) }))}
                  />
                </label>
                <label className="setting-label">
                  AI provider
                  <select
                    value={settings.aiProvider}
                    onChange={(e) => setSettings((s) => ({ ...s, aiProvider: e.target.value as Settings["aiProvider"] }))}
                  >
                    <option value="openrouter">OpenRouter</option>
                    <option value="openai">OpenAI (GPT)</option>
                    <option value="groq">Groq</option>
                  </select>
                </label>
                <label className="setting-label">
                  Model ID
                  <input
                    value={settings.aiModel}
                    onChange={(e) => setSettings((s) => ({ ...s, aiModel: e.target.value }))}
                    placeholder={settings.aiProvider === "openai" ? "OpenAI model ID" : settings.aiProvider === "groq" ? "Groq model ID" : "OpenRouter provider/model ID"}
                  />
                </label>
                <label className="setting-label">
                  Email display name
                  <input
                    value={settings.emailDisplayName}
                    onChange={(e) => setSettings((s) => ({ ...s, emailDisplayName: e.target.value }))}
                    placeholder="Uses SMTP_FROM name by default"
                  />
                </label>
                <p className="settings-help">
                  Choose a provider and model, then save settings. The email display name appears in the From header of sent applications; leave it blank to use the name in SMTP_FROM. Its API key must be configured on the server. Provider-prefixed per-task overrides below take precedence; legacy unprefixed overrides apply to OpenRouter only. The search budget is enforced only for OpenRouter because it reports request cost.
                </p>
                <label className="setting-label">
                  Minimum match score{" "}
                  <div className="range-value">
                    {Math.round(preferences.minMatch * 100)}%
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(preferences.minMatch * 100)}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        minMatch: Number(e.target.value) / 100,
                      }))
                    }
                  />
                </label>
                <label className="source-toggle">
                  <span>
                    <strong>Remote roles</strong>
                    <small>
                      Include remote jobs when offered by a watched company
                    </small>
                  </span>
                  <input
                    type="checkbox"
                    checked={preferences.remote}
                    onChange={(e) =>
                      setPreferences((p) => ({
                        ...p,
                        remote: e.target.checked,
                      }))
                    }
                  />
                </label>
                <div className="settings-card-heading sources-heading">
                  <div>
                    <h2>Integration status</h2>
                    <p>
                      Credentials are read only from server environment
                      variables.
                    </p>
                  </div>
                </div>
                <div className="integration-row">
                  <span>OpenRouter AI</span>
                  <span className="ai-integration-status">
                    {integrations.openRouter ? "Key configured" : "Key not configured"}
                    <small>{aiConnectionChecks.openrouter}</small>
                  </span>
                  <button className="text-button" disabled={busy || aiConnectionChecks.openrouter === "Checking…"} onClick={() => void checkAiProvider("openrouter")}>Test</button>
                </div>
                <div className="integration-row">
                  <span>OpenAI (GPT)</span>
                  <span className="ai-integration-status">{integrations.openai ? "Key configured" : "Key not configured"}<small>{aiConnectionChecks.openai}</small></span>
                  <button className="text-button" disabled={busy || aiConnectionChecks.openai === "Checking…"} onClick={() => void checkAiProvider("openai")}>Test</button>
                </div>
                <div className="integration-row">
                  <span>Groq</span>
                  <span className="ai-integration-status">{integrations.groq ? "Key configured" : "Key not configured"}<small>{aiConnectionChecks.groq}</small></span>
                  <button className="text-button" disabled={busy || aiConnectionChecks.groq === "Checking…"} onClick={() => void checkAiProvider("groq")}>Test</button>
                </div>
                <div className="integration-row">
                  <span>Google indexed web search</span>
                  <span>{integrations.webSearch ? "Connected" : "Set SEARCHAPI_API_KEY"}</span>
                </div>
                <div className="integration-row">
                  <span>X recent posts</span>
                  <span>{integrations.xSearch ? "Connected" : "Optional · set X_BEARER_TOKEN"}</span>
                </div>
                <div className="integration-row">
                  <span>SMTP email</span>
                  <span>
                    {integrations.smtp ? "Connected" : "Not configured"}
                  </span>
                </div>
                <p className="settings-help">
                  API keys are never returned to this page. Configure OPENROUTER_API_KEY, OPENAI_API_KEY, or GROQ_API_KEY in the server environment for the provider you select. SEARCHAPI_API_KEY and X_BEARER_TOKEN configure job sources separately. Google-indexed search includes public LinkedIn and Instagram pages when indexed.
                </p>
                <label className="setting-label">
                  Advanced per-task model overrides
                  <textarea
                    className="watchlist-input"
                    value={modelConfig}
                    onChange={(e) => setModelConfig(e.target.value)}
                    placeholder={"openrouter:extract_job=provider/model-id\nopenai:extract_job=gpt-model-id\ngroq:extract_job=groq-model-id"}
                  />
                </label>
              </section>
            </div>
          </div>
        )}
      </section>
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(null)}>
          <aside className="job-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-top">
              <span className="eyebrow">JOB DETAILS</span>
              <button
                className="icon-button"
                aria-label="Close details"
                onClick={() => setSelected(null)}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="drawer-company">
              <div className="company-logo logo-0">
                {selected.company[0]?.toUpperCase()}
              </div>
              <div>
                <h2>{selected.title}</h2>
                <p>
                  {selected.company} · {selected.city || selected.remote}
                </p>
              </div>
            </div>
            <div className="drawer-badges">
              <span
                className={`verify-badge ${selected.verificationStatus === "verified" ? "verified" : "review"}`}
              >
                <span />
                {selected.verificationStatus.replaceAll("_", " ")}
              </span>
              <span className="tier">Trust tier {selected.tier}</span>
              <span className="drawer-score">
                <Icon name="spark" size={14} />
                {Math.round(selected.matchScore * 100)}% match
              </span>
            </div>
            <div className="drawer-section">
              <h3>Full job description</h3>
              <p className="job-description-full">
                {selected.description ||
                  "No description was provided. Review the employer page before applying."}
              </p>
            </div>
            <div className="drawer-section">
              <h3>Job and recruiter details</h3>
              <div className="job-detail-grid">
                <div><small>Company</small><span>{selected.company}</span></div>
                <div><small>Location</small><span>{selected.city || "Not listed"}</span></div>
                <div><small>Work arrangement</small><span>{selected.remote.replaceAll("_", " ")}</span></div>
                <div><small>Posted</small><span>{selected.postedAt ? new Date(selected.postedAt).toLocaleDateString() : "Date not listed"}</span></div>
                <div><small>Application method</small><span>{selected.applyMethod.replaceAll("_", " ")}</span></div>
                {selected.validThrough && <div><small>Apply by</small><span>{new Date(selected.validThrough).toLocaleDateString()}</span></div>}
              </div>
              {selected.applyEmail ? (
                <p className="recruiter-contact"><strong>Recruiter / application email</strong><a href={`mailto:${selected.applyEmail}`}>{selected.applyEmail}</a></p>
              ) : (
                <p className="recruiter-contact"><strong>Recruiter email</strong><span>Email address not found in the job listing.</span></p>
              )}
              {selected.applyUrl && <a className="detail-link" href={selected.applyUrl} target="_blank" rel="noreferrer">Open application page <Icon name="arrow" size={13} /></a>}
              {selected.sourceUrl && selected.sourceUrl !== selected.applyUrl && <a className="detail-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">Open original job listing <Icon name="arrow" size={13} /></a>}
            </div>
            <div className="drawer-section">
              <h3>Match reasons</h3>
              {selected.matchReasons.length ? (
                selected.matchReasons.map((r) => (
                  <div className="reason" key={r}>
                    <span>
                      <Icon name="check" size={13} />
                    </span>
                    <p>{r}</p>
                  </div>
                ))
              ) : (
                <p>Not enough profile data to explain the match.</p>
              )}
            </div>
            <div className="drawer-section verification-report">
              <h3>Verification report</h3>
              <p>
                <span className="status-dot" />
                {selected.verificationReport.reasoning ||
                  "No verification explanation recorded."}
              </p>
              <small>
                Score {selected.verificationScore.toFixed(2)} · Tier{" "}
                {selected.tier}
              </small>
            </div>
            <div className="drawer-bottom">
              <button
                className="button secondary"
                onClick={() => void verify(selected)}
                disabled={busy}
              >
                Re-verify
              </button>
              <button
                className="button secondary"
                onClick={() => void saveJob(selected)}
              >
                {selected.saved ? "♥ Saved" : "♡ Save"}
              </button>
              <button
                className="button primary"
                onClick={() => void prepare(selected)}
                disabled={busy}
              >
                Prepare application <Icon name="arrow" size={15} />
              </button>
            </div>
            {selected.applyUrl && (
              <a
                className="external-job-link"
                href={selected.applyUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open employer posting <Icon name="arrow" size={13} />
              </a>
            )}
          </aside>
        </div>
      )}
      {reviewApp && (
        <div className="drawer-backdrop" onClick={() => setReviewApp(null)}>
          <aside className="job-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-top">
              <span className="eyebrow">APPLICATION REVIEW</span>
              <button
                className="icon-button"
                onClick={() => setReviewApp(null)}
                aria-label="Close review"
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="drawer-company">
              <div>
                <h2>{reviewApp.title}</h2>
                <p>{reviewApp.company}</p>
              </div>
            </div>
            <div className="drawer-section">
              <h3>Prepared cover letter</h3>
              <textarea
                className="letter-editor"
                value={reviewApp.coverLetter || ""}
                onChange={(event) =>
                  setReviewApp((current) =>
                    current
                      ? { ...current, coverLetter: event.target.value }
                      : current,
                  )
                }
                placeholder="Write a cover letter before sending..."
                aria-label="Prepared cover letter"
              />
              <small>Edit, add, or remove text before approving this application.</small>
            </div>
            <div className="drawer-section">
              <h3>Tailored CV fact check</h3>
              <p>{reviewApp.factCheck?.passed ? "Passed: no added skills, employers, dates, education, certifications, or unsupported numbers were detected." : "Failed: sending is blocked until these mismatches are corrected."}</p>
              {!!reviewApp.factCheck?.issues.length && <ul className="fact-issues">{reviewApp.factCheck.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>}
              <details className="cv-diff">
                <summary>Preview tailored CV and compare with original</summary>
                {reviewApp.tailoredCv&&<div className="cv-preview-content">
                  <h4>Summary</h4><div className="cv-diff-columns"><div><small>Original</small><p>{reviewApp.originalCv?.summary||"No summary"}</p></div><div><small>Tailored</small><p>{reviewApp.tailoredCv.summary}</p></div></div>
                  <h4>Skills</h4><div className="cv-diff-columns"><div><small>Original</small><p>{reviewApp.originalCv?.skills.join(" · ")||"None"}</p></div><div><small>Tailored</small><p>{reviewApp.tailoredCv.skills.join(" · ")}</p></div></div>
                  <h4>Experience changes</h4>
                  {reviewApp.tailoredCv.experience.map((role,index)=>{const source=reviewApp.originalCv?.experience.find(x=>x.company===role.company&&x.title===role.title);return <div className="cv-diff-role" key={`${role.company}-${role.title}-${index}`}><strong>{role.title} · {role.company}</strong><div className="cv-diff-columns"><div><small>Original bullets</small><ul>{(source?.bullets||[]).map((b,i)=><li key={i}>{b}</li>)}</ul></div><div><small>Tailored bullets</small><ul>{role.bullets.map((b,i)=><li key={i}>{b}</li>)}</ul></div></div></div>})}
                  <h4>Education</h4><p>{reviewApp.tailoredCv.education.map(x=>[x.institution,x.degree,x.year].filter(Boolean).join(" · ")).join("; ")||"No education listed"}</p>
                  <h4>Certifications</h4><p>{reviewApp.tailoredCv.certifications.join(" · ")||"No certifications listed"}</p>
                </div>}
              </details>
            </div>
            <div className="drawer-section">
              <h3>{reviewApp.status === "manual_required" ? "Submit this application" : "Before you approve"}</h3>
              <p>
                {reviewApp.status === "manual_required"
                  ? "You can enter a recruiter email below to send this application by email, or leave it blank to use the email from the job listing. If neither is available, approval marks the materials ready for manual submission."
                  : "This will re-check verification, your daily cap and company cooldown. The application letter and tailored CV PDF will be sent to the address below, or to the email from the job listing if left blank. SMTP must be configured for sending."}
              </p>
              <label className="field-label" htmlFor="approval-recruiter-email">Recruiter email (optional)</label>
              <input
                id="approval-recruiter-email"
                type="email"
                autoComplete="email"
                placeholder={reviewApp.applyEmail || "name@company.com"}
                value={recruiterEmail}
                onChange={(event) => setRecruiterEmail(event.target.value)}
              />
              <small>{reviewApp.applyEmail ? `Job listing email: ${reviewApp.applyEmail}. Enter an address above to override it.` : "No recruiter email was included with this job. Enter one above to send by email."}</small>
              {reviewApp.status === "manual_required" && reviewApp.applyUrl && (
                <a className="external-job-link" href={reviewApp.applyUrl} target="_blank" rel="noreferrer">
                  Open employer application page <Icon name="arrow" size={13} />
                </a>
              )}
              {!reviewApp.factCheck?.passed&&<button className="button secondary" disabled={busy} onClick={()=>void replaceWithOriginalCv(reviewApp)}>Replace with original CV PDF</button>}
            </div>
            <div className="drawer-bottom">
              <button
                className="button secondary"
                onClick={() => setReviewApp(null)}
              >
                Go back
              </button>
              <button
                className="button primary"
                disabled={busy || !reviewApp.factCheck?.passed || (reviewApp.status === "manual_required" && reviewApp.events.some((event) => event.event === "approved_handoff") && !(Boolean(recruiterEmail.trim()) && integrations.smtp))}
                onClick={() => {
                  void (async () => {
                    const status = await approve(reviewApp, recruiterEmail);
                    if (status === "sent") {
                      setReviewApp(null);
                    } else if (status === "manual_required") {
                      setReviewApp((current) => current && ({
                        ...current,
                        events: current.events.some((event) => event.event === "approved_handoff")
                          ? current.events
                          : [...current.events, {
                              at: new Date().toISOString(),
                              event: "approved_handoff",
                              message: "Approved for manual submission. No email was sent.",
                            }],
                      }));
                    }
                  })();
                }}
              >
                {reviewApp.status === "manual_required"
                  ? reviewApp.events.some((event) => event.event === "approved_handoff") && !(Boolean(recruiterEmail.trim()) && integrations.smtp)
                    ? "Approved — submit on employer site"
                    : integrations.smtp && (Boolean(recruiterEmail.trim()) || Boolean(reviewApp.applyEmail))
                      ? "Approve & send email"
                      : "Approve for manual submission"
                  : integrations.smtp && (Boolean(recruiterEmail.trim()) || Boolean(reviewApp.applyEmail))
                    ? "Approve & send email"
                    : "Approve & apply"} <Icon name="arrow" size={15} />
              </button>
            </div>
          </aside>
        </div>
      )}
      {notice && (
        <div className="toast">
          <span>
            <Icon name="check" size={15} />
          </span>
          {notice}
          <button onClick={() => setNotice("")}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </main>
  );
}
