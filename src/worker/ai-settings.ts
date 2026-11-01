import { z } from "zod";
import { AppError } from "./errors";
import { encryptSecret, decryptSecret } from "./crypto";
import type { Env } from "./env";

export interface AiSettings {
  apiKey: string;
  model: string;
}

export const aiSettingsSchema = z.object({
  api_key: z.string().trim().min(10, "Enter your OpenRouter API key.").max(300).optional(),
  model: z
    .string()
    .trim()
    .min(1, "Enter a model name, for example openai/gpt-4o-mini.")
    .max(120)
    .regex(/^[A-Za-z0-9._/:-]+$/, "The model name has characters that are not allowed."),
});

function secretOrThrow(env: Env): string {
  if (!env.AI_KEY_SECRET) {
    throw new AppError(503, "ai_not_configured", "AI marking is not set up on the server yet.");
  }
  return env.AI_KEY_SECRET;
}

// Returns the signed-in user's settings, or null when they have not added a key yet.
export async function loadAiSettings(env: Env, userId: number): Promise<AiSettings | null> {
  const row = await env.DB
    .prepare(`SELECT api_key_encrypted, model FROM user_ai_settings WHERE user_id = ?`)
    .bind(userId)
    .first<{ api_key_encrypted: string; model: string }>();
  if (!row) return null;
  const apiKey = await decryptSecret(row.api_key_encrypted, secretOrThrow(env));
  return { apiKey, model: row.model };
}

export async function requireAiSettings(env: Env, userId: number): Promise<AiSettings> {
  const settings = await loadAiSettings(env, userId);
  if (!settings) {
    throw new AppError(503, "ai_not_configured", "Add your OpenRouter key and model in Settings to use AI features.");
  }
  return settings;
}

// Public view: never includes the key itself, only a short hint for recognition.
export async function getAiSettingsView(env: Env, userId: number) {
  const row = await env.DB
    .prepare(`SELECT key_hint, model FROM user_ai_settings WHERE user_id = ?`)
    .bind(userId)
    .first<{ key_hint: string; model: string }>();
  return row ? { configured: true, key_hint: row.key_hint, model: row.model } : { configured: false, key_hint: "", model: "" };
}

export async function saveAiSettings(env: Env, userId: number, input: z.infer<typeof aiSettingsSchema>) {
  const existing = await env.DB
    .prepare(`SELECT api_key_encrypted, key_hint FROM user_ai_settings WHERE user_id = ?`)
    .bind(userId)
    .first<{ api_key_encrypted: string; key_hint: string }>();
  if (!input.api_key && !existing) {
    throw new AppError(400, "invalid_input", "Enter your OpenRouter API key.");
  }
  const secret = secretOrThrow(env);
  const encrypted = input.api_key ? await encryptSecret(input.api_key, secret) : existing!.api_key_encrypted;
  const hint = input.api_key ? input.api_key.slice(-4) : existing!.key_hint;
  await env.DB
    .prepare(
      `INSERT INTO user_ai_settings (user_id, api_key_encrypted, key_hint, model, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         api_key_encrypted = excluded.api_key_encrypted,
         key_hint = excluded.key_hint,
         model = excluded.model,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, encrypted, hint, input.model)
    .run();
}

export async function deleteAiSettings(env: Env, userId: number): Promise<void> {
  await env.DB.prepare(`DELETE FROM user_ai_settings WHERE user_id = ?`).bind(userId).run();
}
