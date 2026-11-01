import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/worker/index";
import { createTestDb } from "./helpers/d1";
import { clubCashFor, gradeMultiplier, MINUTES_PER_FIXTURE } from "../src/shared/rewards";

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

beforeEach(() => {
  db = createTestDb();
});

describe("reward formula", () => {
  it("gives neutral grade multiplier when marks are missing", () => {
    expect(gradeMultiplier(null, null)).toBe(1);
    expect(gradeMultiplier(5, 0)).toBe(1);
  });

  it("scales grade from 0.8x at 0% to 1.45x at 100%", () => {
    expect(gradeMultiplier(0, 10)).toBeCloseTo(0.8);
    expect(gradeMultiplier(10, 10)).toBeCloseTo(1.45);
  });

  it("computes minutes x activity x grade", () => {
    expect(clubCashFor({ minutes: 60, activity: "study", marks_awarded: null, marks_total: null })).toBe(60);
    expect(clubCashFor({ minutes: 60, activity: "past_paper", marks_awarded: null, marks_total: null })).toBe(90);
    expect(clubCashFor({ minutes: 60, activity: "exam_question", marks_awarded: 10, marks_total: 10 })).toBe(108.75);
  });

  it("unlocks one fixture every 90 minutes", () => {
    expect(MINUTES_PER_FIXTURE).toBe(90);
  });
});

describe("sessions routes", () => {
  it("logs a session with server-computed club cash, then lists it", async () => {
    const cookie = await signup("sess1@example.com");
    const res = await call("POST", "/api/sessions", cookie, { minutes: 90, activity: "past_paper" });
    expect(res.status).toBe(201);
    expect((await json(res)).club_cash).toBe(135);

    const list = await json(await call("GET", "/api/sessions", cookie));
    expect(list.sessions).toHaveLength(1);
    expect(list.sessions[0].minutes).toBe(90);
  });

  it("rejects marks awarded above the total", async () => {
    const cookie = await signup("sess2@example.com");
    const res = await call("POST", "/api/sessions", cookie, { minutes: 30, marks_awarded: 12, marks_total: 10 });
    expect(res.status).toBe(400);
  });

  it("rejects zero minutes", async () => {
    const cookie = await signup("sess3@example.com");
    expect((await call("POST", "/api/sessions", cookie, { minutes: 0 })).status).toBe(400);
  });

  it("deletes only the owner's session", async () => {
    const aCookie = await signup("sessA@example.com");
    const bCookie = await signup("sessB@example.com");
    const { id } = await json(await call("POST", "/api/sessions", aCookie, { minutes: 30 }));
    expect((await call("DELETE", `/api/sessions/${id}`, bCookie)).status).toBe(404);
    expect((await call("DELETE", `/api/sessions/${id}`, aCookie)).status).toBe(200);
  });

  it("rejects an unauthenticated request", async () => {
    expect((await call("GET", "/api/sessions", null)).status).toBe(401);
  });
});
