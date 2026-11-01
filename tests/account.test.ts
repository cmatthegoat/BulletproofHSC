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

async function seed(cookie: string) {
  const { id: subjectId } = await json(await call("POST", "/api/subjects", cookie, { name: "Biology" }));
  const point = await json(await call("POST", "/api/syllabus", cookie, { subject_id: subjectId, code: "B1", description: "Cells" }));
  const q = await json(
    await call("POST", "/api/questions", cookie, {
      subject_id: subjectId,
      syllabus_point_id: point.id,
      question_text: "Describe mitosis",
      total_marks: 10,
    }),
  );
  return { subjectId, pointId: point.id, questionId: q.id };
}

beforeEach(() => {
  db = createTestDb();
});

describe("backup export", () => {
  it("exports the user's data without user_id and with no-store caching", async () => {
    const cookie = await signup("bk1@example.com");
    await seed(cookie);
    const res = await call("GET", "/api/account/export", cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.format).toBe("study-backup");
    expect(body.data.subjects).toHaveLength(1);
    expect(body.data.syllabus_points).toHaveLength(1);
    expect(body.data.questions).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("user_id");
    expect(JSON.stringify(body)).not.toContain("password");
  });

  it("requires a session", async () => {
    expect((await call("GET", "/api/account/export", null)).status).toBe(401);
  });
});

describe("backup import", () => {
  it("round-trips into a new account with remapped ids", async () => {
    const source = await signup("bk2@example.com");
    await seed(source);
    const backup = await json(await call("GET", "/api/account/export", source));

    const target = await signup("bk3@example.com");
    const res = await call("POST", "/api/account/import", target, backup);
    expect(res.status).toBe(201);
    expect((await json(res)).imported.subjects).toBe(1);

    const subjects = await json(await call("GET", "/api/subjects", target));
    expect(subjects.subjects.map((s: any) => s.name)).toEqual(["Biology"]);
    const points = await json(await call("GET", `/api/syllabus?subject_id=${subjects.subjects[0].id}`, target));
    expect(points.points[0].code).toBe("B1");
    const questions = await json(await call("GET", `/api/questions?subject_id=${subjects.subjects[0].id}`, target));
    expect(questions.questions[0].syllabus_point_id).toBe(points.points[0].id);
  });

  it("rejects an invalid file without writing anything", async () => {
    const cookie = await signup("bk4@example.com");
    const res = await call("POST", "/api/account/import", cookie, { format: "other", version: 1, data: {} });
    expect(res.status).toBe(400);
    const subjects = await json(await call("GET", "/api/subjects", cookie));
    expect(subjects.subjects).toEqual([]);
  });

  it("rolls back earlier rows when a reference points outside the backup", async () => {
    const cookie = await signup("bk5@example.com");
    const bad = {
      format: "study-backup",
      version: 1,
      data: {
        subjects: [{ id: 1, name: "Chemistry", color: "#4f46e5", course_type: "HSC", notes: "", archived: 0 }],
        syllabus_points: [{ id: 1, subject_id: 999, code: "", module: "", topic: "", description: "Orphan" }],
      },
    };
    const res = await call("POST", "/api/account/import", cookie, bad);
    expect(res.status).toBe(400);
    const subjects = await json(await call("GET", "/api/subjects", cookie));
    expect(subjects.subjects).toEqual([]);
  });
});

describe("account deletion", () => {
  it("requires the correct password", async () => {
    const cookie = await signup("del1@example.com");
    expect((await call("DELETE", "/api/account", cookie, { password: "wrong-password" })).status).toBe(401);
    expect((await call("GET", "/api/subjects", cookie)).status).toBe(200);
  });

  it("deletes the user, their data and their sessions", async () => {
    const cookie = await signup("del2@example.com");
    await seed(cookie);
    const res = await call("DELETE", "/api/account", cookie, { password: "password123" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");

    expect((await call("GET", "/api/subjects", cookie)).status).toBe(401);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM subjects`).first<{ n: number }>())?.n).toBe(0);
    expect((await db.prepare(`SELECT COUNT(*) AS n FROM sessions`).first<{ n: number }>())?.n).toBe(0);
  });

  it("does not let user B delete user A's data", async () => {
    const aCookie = await signup("del3a@example.com");
    const bCookie = await signup("del3b@example.com");
    await seed(aCookie);
    await call("DELETE", "/api/account", bCookie, { password: "password123" });
    const subjects = await json(await call("GET", "/api/subjects", aCookie));
    expect(subjects.subjects).toHaveLength(1);
  });
});
