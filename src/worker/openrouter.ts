import { AppError } from "./errors";
import type { AiSettings } from "./ai-settings";

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const AI_TIMEOUT_MS = 25000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Calls OpenRouter with the signed-in user's own key and model. Returns the assistant text.
// Errors are friendly and never include the API key or the raw provider body.
export async function chatCompletion(settings: AiSettings, messages: ChatMessage[], fetchImpl: typeof fetch = fetch): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: settings.model, messages, temperature: 0.2 }),
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
