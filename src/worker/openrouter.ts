import { AppError } from "./errors";
import type { Env } from "./env";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const AI_TIMEOUT_MS = 25000;
// Used only when OPENROUTER_MODEL is not set. The first model that succeeds is used.
export const FALLBACK_MODELS = ["openai/gpt-4o-mini", "anthropic/claude-3.5-haiku"];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export function modelList(env: Env): string[] {
  const configured = env.OPENROUTER_MODEL?.split(",").map((m) => m.trim()).filter(Boolean) ?? [];
  return configured.length > 0 ? configured : FALLBACK_MODELS;
}

// Calls OpenRouter once for the first model. Returns the assistant text.
// Errors are friendly and never include the API key or the raw provider body.
export async function chatCompletion(env: Env, messages: ChatMessage[], fetchImpl: typeof fetch = fetch): Promise<string> {
  if (!env.OPENROUTER_API_KEY) {
    throw new AppError(503, "ai_not_configured", "AI marking is not set up yet. The site owner needs to add an OpenRouter key.");
  }
  const model = modelList(env)[0];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, temperature: 0.2 }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new AppError(504, "ai_timeout", "The AI took too long to respond. Please try again.");
    }
    throw new AppError(502, "ai_unreachable", "Could not reach the AI service. Please try again.");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    throw new AppError(502, "ai_error", "The AI service returned an error. Please try again later.");
  }
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null;
  const text = body?.choices?.[0]?.message?.content;
  if (!text) throw new AppError(502, "ai_empty", "The AI returned an empty reply. Please try again.");
  return text;
}
