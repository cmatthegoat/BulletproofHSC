import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";
import { ownedSubject } from "./subjects";
import { ACTIVITIES, clubCashFor, type Activity } from "../../shared/rewards";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const sessions = new Hono<Ctx>();

const sessionSchema = z
  .object({
    subject_id: z.number().int().positive().nullable().default(null),
    title: z.string().trim().max(120).default(""),
    activity: z.enum(ACTIVITIES).default("study"),
    minutes: z.number().int().min(1, "Log at least 1 minute.").max(1440, "A session can be 24 hours at most."),
    marks_awarded: z.number().int().min(0).nullable().default(null),
    marks_total: z.number().int().positive().nullable().default(null),
  })
  .refine((v) => v.marks_awarded === null || (v.marks_total !== null && v.marks_awarded <= v.marks_total), {
    message: "Marks awarded can't be more than the total.",
  });

// Logs a study session and stores the club cash it earned.
sessions.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = sessionSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  if (d.subject_id !== null) await ownedSubject(c.env.DB, userId, d.subject_id);

  const clubCash = clubCashFor({
    minutes: d.minutes,
    activity: d.activity as Activity,
    marks_awarded: d.marks_awarded,
    marks_total: d.marks_total,
  });
  const row = await c.env.DB
    .prepare(
      `INSERT INTO study_sessions (user_id, subject_id, title, activity, minutes, marks_awarded, marks_total, club_cash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(userId, d.subject_id, d.title, d.activity, d.minutes, d.marks_awarded, d.marks_total, clubCash)
    .first<{ id: number }>();
  return c.json({ id: row?.id, club_cash: clubCash }, 201);
});

sessions.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await c.env.DB
    .prepare(
      `SELECT id, subject_id, title, activity, minutes, marks_awarded, marks_total, club_cash, logged_at
       FROM study_sessions WHERE user_id = ? ORDER BY logged_at DESC, id DESC LIMIT 100`,
    )
    .bind(userId)
    .all();
  return c.json({ sessions: rows.results });
});

sessions.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, "not_found", "Session not found.");
  const result = await c.env.DB
    .prepare(`DELETE FROM study_sessions WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  if (result.meta.changes === 0) throw new AppError(404, "not_found", "Session not found.");
  return c.json({ ok: true });
});
