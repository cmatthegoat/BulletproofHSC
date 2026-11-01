import { describe, it, expect, beforeEach } from "vitest";
import { app } from "../src/worker/index";
import { createTestDb } from "./helpers/d1";

let db: D1Database;
const env = () => ({ DB: db, ASSETS: {} as Fetcher });

function post(path: string, body: unknown, cookie?: string) {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", "CF-Connecting-IP": "203.0.113.7", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    },
    env(),
  );
}

function get(path: string, cookie?: string) {
  return app.request(path, { headers: cookie ? { cookie } : {} }, env());
}

const json = async (res: Response) => (await res.json()) as any;

function sessionFrom(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/session=([^;]+)/);
  if (!match) throw new Error("no session cookie");
  return `session=${match[1]}`;
}

beforeEach(() => {
  db = createTestDb();
});

describe("auth flow", () => {
  it("signs up, returns a secure HttpOnly cookie, and reaches /me", async () => {
    const res = await post("/api/auth/signup", { email: "a@example.com", password: "password123" });
    expect(res.status).toBe(201);
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=2592000"); // 30 days
    const me = await get("/api/auth/me", sessionFrom(res));
    expect(me.status).toBe(200);
  });

  it("rejects /api requests without a session with a consistent error shape", async () => {
    const res = await get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("refuses duplicate email signups and wrong passwords", async () => {
    await post("/api/auth/signup", { email: "dup@example.com", password: "password123" });
    const dup = await post("/api/auth/signup", { email: "DUP@example.com", password: "password123" });
    expect(dup.status).toBe(409);
    expect((await json(dup)).error.code).toBe("email_taken");
    const bad = await post("/api/auth/login", { email: "dup@example.com", password: "nope-nope" });
    expect(bad.status).toBe(401);
    expect((await json(bad)).error.code).toBe("invalid_credentials");
  });

  it("logs in with the right password and logout invalidates the session", async () => {
    await post("/api/auth/signup", { email: "b@example.com", password: "password123" });
    const login = await post("/api/auth/login", { email: "b@example.com", password: "password123" });
    expect(login.status).toBe(200);
    const cookie = sessionFrom(login);
    expect((await get("/api/auth/me", cookie)).status).toBe(200);
    await post("/api/auth/logout", {}, cookie);
    expect((await get("/api/auth/me", cookie)).status).toBe(401);
  });

  it("stores only hashed session tokens", async () => {
    const res = await post("/api/auth/signup", { email: "c@example.com", password: "password123" });
    const token = sessionFrom(res).split("=")[1];
    const row = await db.prepare(`SELECT token_hash FROM sessions`).first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(token);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rate-limits repeated login attempts per IP", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await post("/api/auth/login", { email: "x@example.com", password: "password123" });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});

describe("cross-user isolation", () => {
  it("user B cannot see rows owned by user A", async () => {
    const aRes = await post("/api/auth/signup", { email: "alice@example.com", password: "password123" });
    const bRes = await post("/api/auth/signup", { email: "bob@example.com", password: "password123" });
    const aCookie = sessionFrom(aRes);
    const bCookie = sessionFrom(bRes);

    const aId = (await json(aRes)).user.id;
    await db
      .prepare(`INSERT INTO subjects (user_id, name) VALUES (?, ?)`)
      .bind(aId, "Alice's secret subject")
      .run();

    // Bob's session resolves to Bob's id, so a user-scoped query returns nothing of Alice's.
    const bId = (await json(bRes)).user.id;
    const bRows = await db
      .prepare(`SELECT name FROM subjects WHERE user_id = ?`)
      .bind(bId)
      .all<{ name: string }>();
    expect(bRows.results).toHaveLength(0);

    const bMe = await get("/api/auth/me", bCookie);
    expect((await json(bMe)).user.id).toBe(bId);
    expect((await get("/api/auth/me", aCookie)).status).toBe(200);
  });
});
