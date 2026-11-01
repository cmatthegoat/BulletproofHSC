export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  DAILY_AI_LIMIT?: string;
}

export type AppVariables = { userId: number };
