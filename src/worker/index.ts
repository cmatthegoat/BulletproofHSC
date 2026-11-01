import { Hono } from "hono";
import { credentialsSchema } from "../shared/schemas";
import { AppError, handleError, errorBody } from "./errors";
import type { Env, AppVariables } from "./env";
import { enforceRateLimit } from "./ratelimit";
import { subjects } from "./routes/subjects";
import { syllabus } from "./routes/syllabus";
import { questions } from "./routes/questions";
import { mistakes } from "./routes/mistakes";
import { stats } from "./routes/stats";
import { sessions } from "./routes/sessions";
import { account } from "./routes/account";
import { aiSettings } from "./routes/ai-settings";
import {
  createUser, checkLogin, createSession, findSessionUser, deleteSession,
  sessionCookie, clearSessionCookie, SESSION_COOKIE,
} from "./auth";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const app = new Hono<Ctx>();

app.onError((err, c) => handleError(err, c));
app.notFound((c) => c.json(errorBody("not_found", "No such endpoint."), 404));

const LOGIN_RULE = { action: "login", limit: 10, windowSeconds: 15 * 60 };
const SIGNUP_RULE = { action: "signup", limit: 5, windowSeconds: 60 * 60 };
// Only these auth endpoints may be called without a session.
const PUBLIC_AUTH_PATHS = new Set(["/api/auth/signup", "/api/auth/login", "/api/auth/logout"]);

function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  return c.req.header("CF-Connecting-IP") ?? "unknown";
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

app.post("/api/auth/signup", async (c) => {
  await enforceRateLimit(c.env.DB, clientIp(c), SIGNUP_RULE);
  const parsed = credentialsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const userId = await createUser(c.env.DB, parsed.data.email, parsed.data.password);
  const token = await createSession(c.env.DB, userId);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ user: { id: userId, email: parsed.data.email } }, 201);
});

app.post("/api/auth/login", async (c) => {
  await enforceRateLimit(c.env.DB, clientIp(c), LOGIN_RULE);
  const parsed = credentialsSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", "Enter your email and password.");
  const userId = await checkLogin(c.env.DB, parsed.data.email, parsed.data.password);
  const token = await createSession(c.env.DB, userId);
  c.header("Set-Cookie", sessionCookie(token));
  return c.json({ user: { id: userId, email: parsed.data.email } });
});

app.post("/api/auth/logout", async (c) => {
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  if (token) await deleteSession(c.env.DB, token);
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

// Every /api route below this point requires a valid session.
app.use("/api/*", async (c, next) => {
  if (PUBLIC_AUTH_PATHS.has(c.req.path)) return next();
  const token = readCookie(c.req.header("Cookie"), SESSION_COOKIE);
  const userId = token ? await findSessionUser(c.env.DB, token) : null;
  if (!userId) throw new AppError(401, "unauthorized", "Please log in to continue.");
  c.set("userId", userId);
  await next();
});

app.get("/api/auth/me", (c) => {
  return c.json({ user: { id: c.get("userId") } });
});

app.route("/api/subjects", subjects);
app.route("/api/syllabus", syllabus);
app.route("/api/questions", questions);
app.route("/api/mistakes", mistakes);
app.route("/api/stats", stats);
app.route("/api/sessions", sessions);
app.route("/api/account", account);
app.route("/api/ai-settings", aiSettings);

export default app;
