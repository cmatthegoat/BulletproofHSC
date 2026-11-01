import { describe, it, expect, beforeEach, afterEach } from "vitest";
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

beforeEach(() => {
  db = createTestDb();
});

describe("subjects", () => {
  it("creates, lists, renames and archives a subject", async () => {
    const cookie = await signup("s1@example.com");
    const created = await call("POST", "/api/subjects", cookie, { name: "Biology", course_type: "HSC" });
    expect(created.status).toBe(201);
    const { id } = await json(created);

    const renamed = await call("PATCH", `/api/subjects/${id}`, cookie, { name: "Biology Advanced" });
    expect(renamed.status).toBe(200);

    const list = await json(await call("GET", "/api/subjects", cookie));
    expect(list.subjects[0].name).toBe("Biology Advanced");
    expect(list.subjects[0].color).toBe("#4f46e5"); // default kept when not sent

    await call("PATCH", `/api/subjects/${id}`, cookie, { archived: true });
    const after = await json(await call("GET", "/api/subjects", cookie));
    expect(after.subjects[0].archived).toBe(1);
  });

  it("rejects an empty update and bad input with the standard error shape", async () => {
    const cookie = await signup("s2@example.com");
    const { id } = await json(await call("POST", "/api/subjects", cookie, { name: "Physics" }));
    const empty = await call("PATCH", `/api/subjects/${id}`, cookie, {});
    expect(empty.status).toBe(400);
    expect((await json(empty)).error.code).toBe("invalid_input");
    const bad = await call("POST", "/api/subjects", cookie, { name: "X", color: "red" });
    expect(bad.status).toBe(400);
  });

  it("deletes a subject and cascades to its syllabus", async () => {
    const cookie = await signup("s3@example.com");
    const { id } = await json(await call("POST", "/api/subjects", cookie, { name: "Chemistry" }));
    await call("POST", "/api/syllabus", cookie, { subject_id: id, description: "Describe bonding" });
    expect((await call("DELETE", `/api/subjects/${id}`, cookie)).status).toBe(200);
    const count = await db.prepare(`SELECT COUNT(*) AS n FROM syllabus_points`).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe("syllabus", () => {
  it("adds points to a subject and lists them", async () => {
    const cookie = await signup("y1@example.com");
    const { id } = await json(await call("POST", "/api/subjects", cookie, { name: "Economics" }));
    const add = await call("POST", "/api/syllabus", cookie, { subject_id: id, code: "EC-1", description: "Explain supply" });
    expect(add.status).toBe(201);
    const list = await json(await call("GET", `/api/syllabus?subject_id=${id}`, cookie));
    expect(list.points).toHaveLength(1);
    expect(list.points[0].code).toBe("EC-1");
  });

  it("saves a reviewed bulk list", async () => {
    const cookie = await signup("y2@example.com");
    const { id } = await json(await call("POST", "/api/subjects", cookie, { name: "Economics" }));
    const res = await call("POST", "/api/syllabus/bulk", cookie, {
      subject_id: id,
      points: [{ description: "A" }, { description: "B", code: "X" }],
    });
    expect(res.status).toBe(201);
    expect((await json(res)).saved).toBe(2);
  });

  it("returns a parsed draft from the AI without saving it", async () => {
    const cookie = await signup("y3@example.com");
    const reply = { choices: [{ message: { content: '{"points":[{"code":"A1","description":"Define GDP"}]}' } }] };
    const env = { ...baseEnv(), AI_KEY_SECRET: "test-secret" };
    await call("PUT", "/api/ai-settings", cookie, { api_key: "sk-or-test-1234", model: "test/model" }, env);
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify(reply), { status: 200 })) as typeof fetch;
    try {
      const res = await call("POST", "/api/syllabus/parse", cookie, { text: "Students explain GDP and its components." }, env);
      expect(res.status).toBe(200);
      expect((await json(res)).draft.points[0].description).toBe("Define GDP");
    } finally {
      globalThis.fetch = realFetch;
    }
    const saved = await db.prepare(`SELECT COUNT(*) AS n FROM syllabus_points`).first<{ n: number }>();
    expect(saved?.n).toBe(0);
  });

  it("returns a friendly error when no AI key is configured", async () => {
    const cookie = await signup("y4@example.com");
    const res = await call("POST", "/api/syllabus/parse", cookie, { text: "Students explain GDP and its components." });
    expect(res.status).toBe(503);
    expect((await json(res)).error.code).toBe("ai_not_configured");
  });
});

describe("cross-user access on real routes", () => {
  it("user B cannot read, edit or delete user A's subject or syllabus", async () => {
    const aCookie = await signup("alice2@example.com");
    const bCookie = await signup("bob2@example.com");
    const { id } = await json(await call("POST", "/api/subjects", aCookie, { name: "Alice private" }));
    const aPoint = await json(await call("POST", "/api/syllabus", aCookie, { subject_id: id, description: "Secret point" }));

    expect((await call("GET", `/api/syllabus?subject_id=${id}`, bCookie)).status).toBe(404);
    expect((await call("PATCH", `/api/subjects/${id}`, bCookie, { name: "hacked" })).status).toBe(404);
    expect((await call("DELETE", `/api/subjects/${id}`, bCookie)).status).toBe(404);
    expect((await call("PATCH", `/api/syllabus/${aPoint.id}`, bCookie, { description: "hacked" })).status).toBe(404);
    expect((await call("DELETE", `/api/syllabus/${aPoint.id}`, bCookie)).status).toBe(404);
    expect((await call("POST", "/api/syllabus", bCookie, { subject_id: id, description: "inject" })).status).toBe(404);

    // Alice's data is unchanged after Bob's attempts.
    const listA = await json(await call("GET", "/api/subjects", aCookie));
    expect(listA.subjects[0].name).toBe("Alice private");
  });
});

afterEach(() => {});
