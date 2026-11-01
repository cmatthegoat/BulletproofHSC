import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "../src/worker/index";
import { createTestDb } from "./helpers/d1";
import { parseMarkingReply, clampResult, dailyLimit } from "../src/worker/marking";

let db: D1Database;
const baseEnv = () => ({ DB: db, ASSETS: {} as Fetcher });
const json = async (res: Response) => (await res.json()) as any;

async function signup(email: string): Promise<string> {
  const res = await app.request(
    "/api/auth/signup",
    { method: "POST", headers: { "content-type": "application/json", "CF-Connecting-IP": `ip-${email}` }, body: JSON.stringify({ email, password: "password123" }) },
    baseEnv(),
  );
  const m = (res.headers.get("set-cookie") ?? "").match(/session=([^;]+)/);
  return `session=${m![1]}`;
}

function call(method: string, path: string, cookie: string | null, body?: unknown, env: any = baseEnv()) {
  return app.request(
    path,
    {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}

const markReply = (marks: number, total: number) =>
  JSON.stringify({
    marks_awarded: marks,
    marks_total: total,
    percentage: 999,
    criteria_breakdown: [{ criterion: "Defines term", awarded: 2, available: 2, comment: "Good" }],
    mistakes: [{ category: "content_gap", description: "Missed an example", correction: "Add one", severity: "low" }],
    model_answer_outline: "Outline",
    next_steps: ["Practise examples"],
  });

function stubAi(bodies: string[]) {
  const realFetch = globalThis.fetch;
  let i = 0;
  globalThis.fetch = (async () => {
    const content = bodies[Math.min(i++, bodies.length - 1)];
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

// The AI key is per user: the test saves one for each account via /api/ai-settings.
const aiEnv = (extra: Record<string, string> = {}) => ({
  ...baseEnv(),
  AI_KEY_SECRET: "test-secret",
  ...extra,
});

async function saveAiKey(cookie: string, env: any = aiEnv()) {
  const res = await call("PUT", "/api/ai-settings", cookie, { api_key: "sk-or-test-1234", model: "test/model" }, env);
  expect(res.status).toBe(200);
}

async function makeQuestion(cookie: string, env: any = baseEnv()) {
  const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "Biology" }, env));
  const q = await json(
    await call("POST", "/api/questions", cookie, {
      subject_id: subjectId,
      question_text: "Explain osmosis.",
      total_marks: 4,
      marking_criteria: "Defines osmosis",
      student_answer: "Water moves across a membrane.",
    }, env),
  );
  return { subjectId, questionId: q.id as number };
}

beforeEach(() => {
  db = createTestDb();
});

afterEach(() => {});

describe("marking reply parsing and clamping", () => {
  it("parses a valid reply and accepts a fenced one", () => {
    expect(parseMarkingReply(markReply(3, 4))?.marks_awarded).toBe(3);
    expect(parseMarkingReply("```json\n" + markReply(3, 4) + "\n```")?.marks_awarded).toBe(3);
  });

  it("returns null for malformed or schema-violating replies", () => {
    expect(parseMarkingReply("not json")).toBeNull();
    expect(parseMarkingReply('{"marks_awarded":"three"}')).toBeNull();
    expect(parseMarkingReply("")).toBeNull();
  });

  it("clamps marks to the real total and recomputes the percentage", () => {
    const reply = parseMarkingReply(markReply(9, 4))!;
    const result = clampResult(reply, 4);
    expect(result.marks_awarded).toBe(4);
    expect(result.marks_total).toBe(4);
    expect(result.percentage).toBe(100);
  });

  it("clamps negative marks to zero", () => {
    const result = clampResult(parseMarkingReply(markReply(-2, 4))!, 4);
    expect(result.marks_awarded).toBe(0);
    expect(result.percentage).toBe(0);
  });

  it("uses the default daily limit when the setting is missing or invalid", () => {
    expect(dailyLimit({ DB: db } as any)).toBe(20);
    expect(dailyLimit({ DB: db, DAILY_AI_LIMIT: "abc" } as any)).toBe(20);
    expect(dailyLimit({ DB: db, DAILY_AI_LIMIT: "5" } as any)).toBe(5);
  });
});

describe("questions", () => {
  it("creates, lists, edits and deletes a question", async () => {
    const cookie = await signup("q1@example.com");
    const { subjectId, questionId } = await makeQuestion(cookie);

    const list = await json(await call("GET", `/api/questions?subject_id=${subjectId}`, cookie));
    expect(list.questions).toHaveLength(1);

    const edit = await call("PATCH", `/api/questions/${questionId}`, cookie, { total_marks: 6 });
    expect(edit.status).toBe(200);
    const detail = await json(await call("GET", `/api/questions/${questionId}`, cookie));
    expect(detail.question.total_marks).toBe(6);
    expect(detail.question.question_text).toBe("Explain osmosis.");

    expect((await call("DELETE", `/api/questions/${questionId}`, cookie)).status).toBe(200);
  });

  it("rejects zero or fractional marks", async () => {
    const cookie = await signup("q2@example.com");
    const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "Maths" }));
    const zero = await call("POST", "/api/questions", cookie, { subject_id: subjectId, question_text: "Q", total_marks: 0 });
    expect(zero.status).toBe(400);
    const frac = await call("POST", "/api/questions", cookie, { subject_id: subjectId, question_text: "Q", total_marks: 2.5 });
    expect(frac.status).toBe(400);
  });

  it("refuses to mark an empty answer", async () => {
    const cookie = await signup("q3@example.com");
    const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "Maths" }));
    const { id } = await json(await call("POST", "/api/questions", cookie, { subject_id: subjectId, question_text: "Q", total_marks: 2 }));
    const res = await call("POST", `/api/questions/${id}/mark`, cookie, undefined, aiEnv());
    expect(res.status).toBe(400);
  });
});

describe("AI marking", () => {
  it("stores a clamped attempt and returns the result", async () => {
    const cookie = await signup("m1@example.com");
    const env = aiEnv();
    await saveAiKey(cookie, env);
    const { questionId } = await makeQuestion(cookie, env);
    const restore = stubAi([markReply(9, 4)]);
    try {
      const res = await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, env);
      expect(res.status).toBe(201);
      const body = await json(res);
      expect(body.result.marks_awarded).toBe(4);
      expect(body.result.percentage).toBe(100);
    } finally {
      restore();
    }
    const stored = await db.prepare(`SELECT COUNT(*) AS n FROM attempts`).first<{ n: number }>();
    expect(stored?.n).toBe(1);
  });

  it("retries once with the stricter prompt after a bad reply", async () => {
    const cookie = await signup("m2@example.com");
    const env = aiEnv();
    await saveAiKey(cookie, env);
    const { questionId } = await makeQuestion(cookie, env);
    const restore = stubAi(["sorry, no json", markReply(2, 4)]);
    try {
      const res = await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, env);
      expect(res.status).toBe(201);
      expect((await json(res)).result.marks_awarded).toBe(2);
    } finally {
      restore();
    }
  });

  it("returns a clear error and releases the quota when the AI reply stays malformed", async () => {
    const cookie = await signup("m3@example.com");
    const env = aiEnv({ DAILY_AI_LIMIT: "1" });
    await saveAiKey(cookie, env);
    const { questionId } = await makeQuestion(cookie, env);
    const restore = stubAi(["bad", "still bad"]);
    try {
      const res = await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, env);
      expect(res.status).toBe(502);
      expect((await json(res)).error.code).toBe("ai_bad_format");
    } finally {
      restore();
    }
    // The failed call gave its quota back, so one more call is still allowed.
    const row = await db.prepare(`SELECT count FROM ai_usage`).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("enforces the daily limit", async () => {
    const cookie = await signup("m4@example.com");
    const env = aiEnv({ DAILY_AI_LIMIT: "1" });
    await saveAiKey(cookie, env);
    const { questionId } = await makeQuestion(cookie, env);
    const restore = stubAi([markReply(3, 4)]);
    try {
      expect((await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, env)).status).toBe(201);
      const second = await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, env);
      expect(second.status).toBe(429);
      expect((await json(second)).error.code).toBe("ai_limit");
    } finally {
      restore();
    }
  });

  it("returns a friendly error when no AI key is set", async () => {
    const cookie = await signup("m5@example.com");
    const { questionId } = await makeQuestion(cookie);
    const res = await call("POST", `/api/questions/${questionId}/mark`, cookie, undefined, baseEnv());
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_not_configured");
  });
});

describe("cross-user access on question routes", () => {
  it("user B cannot read, edit, delete or mark user A's question", async () => {
    const aCookie = await signup("qa@example.com");
    const bCookie = await signup("qb@example.com");
    const env = aiEnv();
    await saveAiKey(bCookie, env);
    const { subjectId, questionId } = await makeQuestion(aCookie, env);

    expect((await call("GET", `/api/questions/${questionId}`, bCookie)).status).toBe(404);
    expect((await call("PATCH", `/api/questions/${questionId}`, bCookie, { total_marks: 1 })).status).toBe(404);
    expect((await call("DELETE", `/api/questions/${questionId}`, bCookie)).status).toBe(404);
    expect((await call("GET", `/api/questions?subject_id=${subjectId}`, bCookie)).status).toBe(404);
    expect((await call("POST", "/api/questions", bCookie, { subject_id: subjectId, question_text: "x", total_marks: 1 })).status).toBe(404);

    const restore = stubAi([markReply(1, 4)]);
    try {
      expect((await call("POST", `/api/questions/${questionId}/mark`, bCookie, undefined, env)).status).toBe(404);
    } finally {
      restore();
    }
    // Bob's attempts did not spend AI quota or write an attempt.
    const attempts = await db.prepare(`SELECT COUNT(*) AS n FROM attempts`).first<{ n: number }>();
    expect(attempts?.n).toBe(0);
    const quota = await db.prepare(`SELECT COUNT(*) AS n FROM ai_usage`).first<{ n: number }>();
    expect(quota?.n).toBe(0);
  });
});
