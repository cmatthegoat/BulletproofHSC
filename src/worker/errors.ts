import type { Context } from "hono";

export class AppError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503 | 504,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function handleError(err: unknown, c: Context) {
  if (err instanceof AppError) {
    return c.json(errorBody(err.code, err.message), err.status);
  }
  console.error("unhandled", err instanceof Error ? err.name : "unknown");
  return c.json(errorBody("internal_error", "Something went wrong. Please try again."), 500);
}
