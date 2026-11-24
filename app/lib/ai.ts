import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { sqlite } from "./db";
import type { ZodType } from "zod";
import { getProfileId } from "./http";

export const PROMPT_VERSION = "2026-10-05-v1";
const taskModels: Record<string, string> = { parse_cv: "OPENROUTER_MODEL_CV", search_targets: "OPENROUTER_MODEL_CV", verify_job: "OPENROUTER_MODEL_CHEAP", match_job: "OPENROUTER_MODEL_CHEAP", extract_job: "OPENROUTER_MODEL_CHEAP", tailor_cv: "OPENROUTER_MODEL_WRITING", cover_letter: "OPENROUTER_MODEL_WRITING" };

function parseJsonObject(content: string) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try { return JSON.parse(trimmed) as unknown; } catch {}

  // Some OpenRouter model/provider combinations prepend a safety note or
  // markdown around otherwise valid JSON. Extract the first complete object.
  const start = trimmed.indexOf("{");
  if (start < 0) throw new Error("Model response did not contain a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index++) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return JSON.parse(trimmed.slice(start, index + 1)) as unknown;
  }
  throw new Error("Model response contained an incomplete JSON object");
}

function describeRequestError(error: unknown) {
  if (!(error instanceof Error)) return "AI request failed";
  const cause = error.cause;
  if (cause && typeof cause === "object") {
    const detail = cause as { code?: unknown; message?: unknown };
    const code = typeof detail.code === "string" ? detail.code : "";
    const message = typeof detail.message === "string" ? detail.message : "";
    const suffix = [code, message].filter(Boolean).join(": ");
    if (suffix) return `${error.message} (${suffix})`;
  }
  return error.message;
}

export async function askJson<T>(task: string, system: string, user: string, schema: ZodType<T>, temperature = 0.1, runStartedAt?: string): Promise<T | null> {
  const profileId = await getProfileId();
  const settingsRow = profileId ? sqlite.prepare("SELECT settings_json FROM profile WHERE id=?").get(profileId) as { settings_json?: string } | undefined : undefined;
  const settings = settingsRow?.settings_json ? JSON.parse(settingsRow.settings_json) as { models?: Record<string,string>; perRunBudgetUsd?: number; aiProvider?: "openrouter" | "openai" | "groq"; aiModel?: string } : {};
  const provider = settings.aiProvider || "openrouter";
  const providers = {
    openrouter: { key: process.env.OPENROUTER_API_KEY, endpoint: "https://openrouter.ai/api/v1/chat/completions", fallbackEnv: "OPENROUTER_FALLBACK_MODEL" },
    openai: { key: process.env.OPENAI_API_KEY, endpoint: "https://api.openai.com/v1/chat/completions", fallbackEnv: "OPENAI_FALLBACK_MODEL" },
    groq: { key: process.env.GROQ_API_KEY, endpoint: "https://api.groq.com/openai/v1/chat/completions", fallbackEnv: "GROQ_FALLBACK_MODEL" },
  } as const;
  const selectedProvider = providers[provider];
  const providerName = provider === "openai" ? "OpenAI" : provider === "groq" ? "Groq" : "OpenRouter";
  const key = selectedProvider.key;
  if (!key) {
    console.error(`[ai:${task}] ${provider} API key is not configured`);
    return null;
  }
  if (runStartedAt && provider === "openrouter") {
    const spent = sqlite.prepare("SELECT coalesce(sum(cost),0) AS total FROM llm_calls WHERE created_at>=?").get(runStartedAt) as {total:number};
    if (spent.total >= (settings.perRunBudgetUsd ?? 1)) return null;
  }
  const providerTaskModel = provider === "openrouter"
    ? process.env[taskModels[task] || "OPENROUTER_MODEL_CHEAP"] || process.env.OPENROUTER_MODEL
    : provider === "openai" ? process.env.OPENAI_MODEL : process.env.GROQ_MODEL;
  const model = settings.models?.[`${provider}:${task}`]
    || (provider === "openrouter" ? settings.models?.[task] : undefined)
    || settings.aiModel?.trim()
    || providerTaskModel;
  if(!model) {
    console.error(`[ai:${task}] No model ID is configured for ${provider}`);
    return null;
  }
  const fallbackModel = settings.models?.[`${provider}:${task}_fallback`]
    || (provider === "openrouter" ? settings.models?.[`${task}_fallback`] : undefined)
    || process.env[selectedProvider.fallbackEnv];
  const attempts = fallbackModel && fallbackModel !== model ? [model, model, fallbackModel] : [model, model];
  const jsonSchema = z.toJSONSchema(schema, { unrepresentable: "any" });
  const prompt = `${system}\n\nOutput must conform to this JSON schema:\n${JSON.stringify(jsonSchema)}\nReturn only a JSON object matching this schema. No markdown or commentary.`;
  let validationError = "";
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    const attemptModel = attempts[attempt];
    let response: Response;
    try {
      const requestBody = {
        model: attemptModel,
        temperature,
        ...(provider === "openrouter" ? { usage: { include: true } } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: attempt ? `${user}\n\nThe previous output failed validation: ${validationError}. Correct it and return one JSON object only, with no safety notes or markdown.` : user },
        ],
      };
      const headers: Record<string,string> = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = process.env.APP_URL || "http://localhost:3000";
        headers["X-Title"] = "Job Finder";
      }
      response = await fetch(selectedProvider.endpoint, { method: "POST", headers, body: JSON.stringify(requestBody), signal: AbortSignal.timeout(task === "extract_job" ? 30_000 : 60_000) });
      if (!response.ok) {
        const responseText = await response.text().catch(() => "");
        let providerMessage = "";
        try {
          const parsedError = JSON.parse(responseText) as { error?: { message?: unknown } };
          if (typeof parsedError.error?.message === "string") providerMessage = parsedError.error.message.slice(0, 240);
        } catch {}
        throw new Error(`${providerName} returned ${response.status}${providerMessage ? `: ${providerMessage}` : ""}`);
      }
      const payload = await response.json() as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new Error(`${providerName} returned an empty response`);
      const trackedCost=typeof payload.usage?.cost==="number"&&Number.isFinite(payload.usage.cost)?payload.usage.cost:(settings.perRunBudgetUsd??1);
      sqlite.prepare("INSERT INTO llm_calls(id,task,model,tokens_in,tokens_out,cost,prompt_version,created_at) VALUES(?,?,?,?,?,?,?,?)").run(randomUUID(), task, `${provider}:${attemptModel}`, payload.usage?.prompt_tokens || 0, payload.usage?.completion_tokens || 0, provider === "openrouter" ? trackedCost : 0, PROMPT_VERSION, new Date().toISOString());
      const parsed = schema.safeParse(parseJsonObject(content));
      if (parsed.success) return parsed.data;
      validationError=JSON.stringify(parsed.error.issues).slice(0,1500);
    } catch (err) {
      validationError=describeRequestError(err);
      if (attempt === attempts.length-1) console.error(`[ai:${task}]`, validationError);
      else await new Promise(resolve=>setTimeout(resolve,attempt===0?2000:8000));
    }
  }
  return null;
}
