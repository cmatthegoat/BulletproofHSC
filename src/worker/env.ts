export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  // Secret used to encrypt each user's OpenRouter key at rest. Set with `wrangler secret put AI_KEY_SECRET`.
  AI_KEY_SECRET?: string;
  DAILY_AI_LIMIT?: string;
}

export type AppVariables = { userId: number };
