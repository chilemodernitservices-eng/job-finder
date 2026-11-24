import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sqlite } from "@/app/lib/db";
import { getProfileId, guard, jsonError } from "@/app/lib/http";

export const runtime = "nodejs";

const Input = z.object({
  provider: z.enum(["openrouter", "openai", "groq"]),
  model: z.string().max(200).optional(),
});

const providers = {
  openrouter: {
    key: "OPENROUTER_API_KEY",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    name: "OpenRouter",
  },
  openai: {
    key: "OPENAI_API_KEY",
    endpoint: "https://api.openai.com/v1/chat/completions",
    name: "OpenAI",
  },
  groq: {
    key: "GROQ_API_KEY",
    endpoint: "https://api.groq.com/openai/v1/chat/completions",
    name: "Groq",
  },
} as const;

export async function POST(request: NextRequest) {
  const denied = await guard();
  if (denied) return denied;
  const profileId = await getProfileId(); if (!profileId) return jsonError("Sign in to use the job finder API", 401);
  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Choose an AI provider to check");

  const provider = providers[parsed.data.provider];
  const key = process.env[provider.key];
  if (!key)
    return jsonError(
      `${provider.key} is not configured in the server environment`,
      409,
    );

  const profile = sqlite
    .prepare("SELECT settings_json FROM profile WHERE id=?")
    .get(profileId) as { settings_json: string };
  const settings = JSON.parse(profile.settings_json) as {
    models?: Record<string, string>;
  };
  const providerName = parsed.data.provider;
  const model =
    parsed.data.model?.trim() ||
    settings.models?.[`${providerName}:extract_job`] ||
    (providerName === "openrouter"
      ? settings.models?.extract_job
      : undefined) ||
    (providerName === "openrouter"
      ? process.env.OPENROUTER_MODEL_CHEAP || process.env.OPENROUTER_MODEL
      : undefined) ||
    (providerName === "openai" ? process.env.OPENAI_MODEL : undefined) ||
    (providerName === "groq" ? process.env.GROQ_MODEL : undefined);
  if (!model)
    return jsonError(
      `No model ID is configured for ${provider.name}. Enter one in Profile & settings or set its model environment variable.`,
      409,
    );

  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  if (providerName === "openrouter") {
    headers["HTTP-Referer"] = process.env.APP_URL || "http://localhost:3000";
    headers["X-Title"] = "Job Finder";
  }

  try {
    const response = await fetch(provider.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        temperature: 0,
        ...(providerName === "openrouter" ? { usage: { include: true } } : {}),
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Return one JSON object only." },
          { role: "user", content: 'Return {"ok":true}.' },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let detail = "";
      try {
        const error = JSON.parse(body) as { error?: { message?: unknown } };
        if (typeof error.error?.message === "string")
          detail = error.error.message.slice(0, 240);
      } catch {}
      return jsonError(
        `${provider.name} rejected the test request (${response.status})${detail ? `: ${detail}` : ""}`,
        response.status === 401 || response.status === 403 ? 401 : 502,
      );
    }
    const result = (await response.json()) as { choices?: unknown[] };
    if (!result.choices?.length)
      return jsonError(
        `${provider.name} accepted the request but returned no completion`,
        502,
      );
    return NextResponse.json({
      status: "connected",
      provider: providerName,
      model,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Connection failed";
    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : "";
    return jsonError(
      `${provider.name} connection failed: ${message}${cause ? ` (${cause})` : ""}`,
      502,
    );
  }
}
