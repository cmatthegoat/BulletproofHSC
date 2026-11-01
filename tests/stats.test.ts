import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/worker/index";
import { createTestDb } from "./helpers/d1";

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

// Inserts an attempt directly so the aggregate values are known exactly.
async function attempt(userId: number, subjectId: number, pct: number, syllabusPointId: number | null = null) {
  const q = await db
    .prepare(`INSERT INTO questions (user_id, subject_id, question_text, total_marks) VALUES (?, ?, 'Q', 10) RETURNING id`)
    .bind(userId, subjectId)
    .first<{ id: number }>();
  await db
    .prepare(
      `INSERT INTO attempts (user_id, question_id, subject_id, syllabus_point_id, marks_awarded, marks_total, percentage)
       VALUES (?, ?, ?, ?, ?, 10, ?)`,
    )
    .bind(userId, q!.id, subjectId, syllabusPointId, pct / 10, pct)
    .run();
}

async function userIdOf(cookie: string): Promise<number> {
  const me = await json(await call("GET", "/api/auth/me", cookie));
  return me.user.id;
}

beforeEach(() => {
  db = createTestDb();
});

describe("stats", () => {
  it("returns an empty dashboard for a new user", async () => {
    const cookie = await signup("st0@example.com");
    const res = await call("GET", "/api/stats", cookie);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.by_subject).toEqual([]);
    expect(body.trend).toEqual([]);
    expect(body.weak_points).toEqual([]);
  });

  it("computes the average percentage per subject from attempts", async () => {
    const cookie = await signup("st1@example.com");
    const uid = await userIdOf(cookie);
    const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "Physics" }));
    await attempt(uid, subjectId, 40);
    await attempt(uid, subjectId, 80);

    const body = await json(await call("GET", "/api/stats", cookie));
    const physics = body.by_subject.find((s: any) => s.subject_id === subjectId);
    expect(physics.attempts).toBe(2);
    expect(physics.average_percentage).toBe(60);
  });

  it("finds the weakest syllabus point by average", async () => {
    const cookie = await signup("st2@example.com");
    const uid = await userIdOf(cookie);
    const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "History" }));
    const weakPoint = await json(await call("POST", "/api/syllabus", cookie, { subject_id: subjectId, code: "H1", description: "Weak" }));
    const strongPoint = await json(await call("POST", "/api/syllabus", cookie, { subject_id: subjectId, code: "H2", description: "Strong" }));
    await attempt(uid, subjectId, 20, weakPoint.id);
    await attempt(uid, subjectId, 90, strongPoint.id);

    const body = await json(await call("GET", "/api/stats", cookie));
    expect(body.weak_points[0].code).toBe("H1");
    expect(body.weak_points[0].average_percentage).toBe(20);
  });

  it("filters to one subject when asked", async () => {
    const cookie = await signup("st3@example.com");
    const uid = await userIdOf(cookie);
    const { id: a } = await json(await call("POST", "/api/subjects", cookie, { name: "Maths" }));
    const { id: b } = await json(await call("POST", "/api/subjects", cookie, { name: "English" }));
    await attempt(uid, a, 50);
    await attempt(uid, b, 90);

    const body = await json(await call("GET", `/api/stats?subject_id=${a}`, cookie));
    expect(body.by_subject).toHaveLength(1);
    expect(body.by_subject[0].average_percentage).toBe(50);
  });

  it("does not show user A's stats to user B", async () => {
    const aCookie = await signup("sta@example.com");
    const bCookie = await signup("stb@example.com");
    const aId = await userIdOf(aCookie);
    const { id: subjectId } = await json(await call("POST", "/api/subjects", aCookie, { name: "Secret" }));
    await attempt(aId, subjectId, 99);

    expect((await call("GET", `/api/stats?subject_id=${subjectId}`, bCookie)).status).toBe(404);
    const bBody = await json(await call("GET", "/api/stats", bCookie));
    expect(bBody.by_subject).toEqual([]);
    expect(bBody.trend).toEqual([]);
  });
});
