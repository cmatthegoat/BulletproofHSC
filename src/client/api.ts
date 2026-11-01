export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

// Sends a JSON request to the Worker. Cookies are sent so the session is kept.
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    credentials: "same-origin",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiError(res.status, err.code ?? "error", err.message ?? "Something went wrong. Please try again.");
  }
  return data as T;
}

export interface User {
  id: number;
  email?: string;
}

export interface Subject {
  id: number;
  name: string;
  color: string;
  course_type: string;
  notes: string;
  archived: number;
}

export interface StatsResponse {
  by_subject: { subject_id: number; name: string; color: string; attempts: number; average_percentage: number | null }[];
  open_mistakes_by_category: { category: string; count: number; repeats: number }[];
}
