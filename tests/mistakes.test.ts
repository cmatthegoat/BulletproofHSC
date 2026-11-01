import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/worker/index";
import { createTestDb } from "./helpers/d1";
import { nextStage, nextReviewAt, normaliseDescription, REVIEW_INTERVAL_DAYS } from "../src/worker/review";

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

function call(method: string, path: string, cookie: string | null, body?: unknown) {
  return app.request(
    path,
    {
      method,
      headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    baseEnv(),
  );
}

async function subjectFor(cookie: string): Promise<number> {
  const { id } = await json(await call("POST", "/api/subjects", cookie, { name: "Chemistry" }));
  return id;
}

async function mistakeFor(cookie: string, subjectId: number, description: string) {
  // Mistakes come from marking, so insert through the same recording function the route uses.
  const { recordMistake } = await import("../src/worker/routes/mistakes");
  const me = await json(await call("GET", "/api/auth/me", cookie));
  const userId = me.user.id as number;
  return recordMistake(db, userId, {
    subject_id: subjectId,
    syllabus_point_id: null,
    category: "content_gap",
    description,
    correction: "Correct it",
    severity: "medium",
    question_id: null,
    attempt_id: null,
  });
}

beforeEach(() => {
  db = createTestDb();
});

describe("review schedule", () => {
  it("moves up a stage on got_it and resets on still_struggling", () => {
    expect(nextStage(0, "got_it")).toBe(1);
    expect(nextStage(4, "got_it")).toBe(5);
    expect(nextStage(5, "got_it")).toBe(5);
    expect(nextStage(3, "still_struggling")).toBe(0);
  });

  it("schedules the next review by stage interval", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(nextReviewAt(1, from)).toBe("2026-01-02 00:00:00");
    expect(nextReviewAt(3, from)).toBe("2026-01-08 00:00:00");
    expect(REVIEW_INTERVAL_DAYS).toHaveLength(6);
  });

  it("normalises descriptions so near-identical wording matches", () => {
    expect(normaliseDescription("  Forgot the  Units!  ")).toBe("forgot the units");
    expect(normaliseDescription("forgot the units")).toBe("forgot the units");
  });
});

describe("mistake journal", () => {
  it("merges a repeated mistake instead of duplicating it", async () => {
    const cookie = await signup("mj1@example.com");
    const subjectId = await subjectFor(cookie);
    const first = await mistakeFor(cookie, subjectId, "Forgot the units");
    const second = await mistakeFor(cookie, subjectId, "forgot the units");
    expect(first.merged).toBe(false);
    expect(second.merged).toBe(true);
    expect(second.id).toBe(first.id);

    const list = await json(await call("GET", `/api/mistakes?subject_id=${subjectId}`, cookie));
    expect(list.mistakes).toHaveLength(1);
    expect(list.mistakes[0].repeat_count).toBe(2);

    const occ = await db.prepare(`SELECT COUNT(*) AS n FROM mistake_occurrences`).first<{ n: number }>();
    expect(occ?.n).toBe(2);
  });

  it("makes a mistake due immediately and advances it on a review", async () => {
    const cookie = await signup("mj2@example.com");
    const subjectId = await subjectFor(cookie);
    const { id } = await mistakeFor(cookie, subjectId, "Wrong formula");

    const due = await json(await call("GET", "/api/mistakes/due", cookie));
    expect(due.due.some((m: any) => m.id === id)).toBe(true);

    const reviewed = await json(await call("POST", `/api/mistakes/${id}/review`, cookie, { result: "got_it" }));
    expect(reviewed.review_stage).toBe(1);
    expect(reviewed.status).toBe("reviewing");

    const stillDue = await json(await call("GET", "/api/mistakes/due", cookie));
    expect(stillDue.due.some((m: any) => m.id === id)).toBe(false);
  });

  it("resets the stage when the user is still struggling", async () => {
    const cookie = await signup("mj3@example.com");
    const subjectId = await subjectFor(cookie);
    const { id } = await mistakeFor(cookie, subjectId, "Mixed up terms");
    await call("POST", `/api/mistakes/${id}/review`, cookie, { result: "got_it" });
    const reset = await json(await call("POST", `/api/mistakes/${id}/review`, cookie, { result: "still_struggling" }));
    expect(reset.review_stage).toBe(0);
  });

  it("rejects an invalid status and an invalid review result", async () => {
    const cookie = await signup("mj4@example.com");
    const subjectId = await subjectFor(cookie);
    const { id } = await mistakeFor(cookie, subjectId, "Missed a step");
    expect((await call("PATCH", `/api/mistakes/${id}/status`, cookie, { status: "done" })).status).toBe(400);
    expect((await call("POST", `/api/mistakes/${id}/review`, cookie, { result: "maybe" })).status).toBe(400);
  });

  it("keeps user B out of user A's mistakes and reviews", async () => {
    const aCookie = await signup("mja@example.com");
    const bCookie = await signup("mjb@example.com");
    const subjectId = await subjectFor(aCookie);
    const { id } = await mistakeFor(aCookie, subjectId, "Private mistake");

    expect((await call("GET", `/api/mistakes?subject_id=${subjectId}`, bCookie)).status).toBe(404);
    expect((await call("PATCH", `/api/mistakes/${id}/status`, bCookie, { status: "fixed" })).status).toBe(404);
    expect((await call("POST", `/api/mistakes/${id}/review`, bCookie, { result: "got_it" })).status).toBe(404);

    const reviews = await db.prepare(`SELECT COUNT(*) AS n FROM reviews`).first<{ n: number }>();
    expect(reviews?.n).toBe(0);
    const due = await json(await call("GET", "/api/mistakes/due", bCookie));
    expect(due.due).toHaveLength(0);
  });
});
