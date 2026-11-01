import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";
import { ownedSubject } from "./subjects";
import { nextReviewAt, nextStage, normaliseDescription } from "../review";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const mistakes = new Hono<Ctx>();

const statusSchema = z.object({ status: z.enum(["open", "reviewing", "fixed"]) });
const reviewSchema = z.object({ result: z.enum(["got_it", "still_struggling"]) });

type MistakeRow = {
  id: number;
  subject_id: number;
  syllabus_point_id: number | null;
  category: string;
  description: string;
  correction: string;
  severity: string;
  status: string;
  repeat_count: number;
  review_stage: number;
  next_review_at: string | null;
};

async function ownedMistake(db: D1Database, userId: number, id: number): Promise<MistakeRow> {
  const row = await db
    .prepare(
      `SELECT id, subject_id, syllabus_point_id, category, description, correction, severity,
              status, repeat_count, review_stage, next_review_at
       FROM mistakes WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<MistakeRow>();
  if (!row) throw new AppError(404, "not_found", "Mistake not found.");
  return row;
}

// Records one occurrence of a mistake. If the same mistake (same subject, category and
// normalised description) already exists for this user, it is merged instead of duplicated.
export async function recordMistake(
  db: D1Database,
  userId: number,
  input: {
    subject_id: number;
    syllabus_point_id: number | null;
    category: string;
    description: string;
    correction: string;
    severity: string;
    question_id: number | null;
    attempt_id: number | null;
  },
): Promise<{ id: number; merged: boolean }> {
  const key = normaliseDescription(input.description);
  const existing = await db
    .prepare(
      `SELECT id FROM mistakes
       WHERE user_id = ? AND subject_id = ? AND category = ? AND
             lower(trim(description)) = ?`,
    )
    .bind(userId, input.subject_id, input.category, input.description.trim().toLowerCase())
    .first<{ id: number }>();

  let id: number;
  let merged = false;
  if (existing) {
    id = existing.id;
    merged = true;
    await db
      .prepare(`UPDATE mistakes SET repeat_count = repeat_count + 1, status = CASE WHEN status = 'fixed' THEN 'open' ELSE status END, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .bind(id, userId)
      .run();
  } else {
    const row = await db
      .prepare(
        `INSERT INTO mistakes (user_id, subject_id, syllabus_point_id, category, description, correction, severity, next_review_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now')) RETURNING id`,
      )
      .bind(userId, input.subject_id, input.syllabus_point_id, input.category, input.description, input.correction, input.severity)
      .first<{ id: number }>();
    id = row!.id;
  }
  await db
    .prepare(
      `INSERT INTO mistake_occurrences (user_id, mistake_id, question_id, attempt_id, description, correction)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(userId, id, input.question_id, input.attempt_id, input.description, input.correction)
    .run();
  return { id, merged };
}

mistakes.get("/", async (c) => {
  const userId = c.get("userId");
  const subjectId = Number(c.req.query("subject_id"));
  if (!Number.isInteger(subjectId) || subjectId <= 0) throw new AppError(400, "invalid_input", "Choose a subject.");
  await ownedSubject(c.env.DB, userId, subjectId);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, subject_id, syllabus_point_id, category, description, correction, severity,
              status, repeat_count, review_stage, next_review_at
       FROM mistakes WHERE user_id = ? AND subject_id = ? ORDER BY repeat_count DESC, id DESC`,
    )
    .bind(userId, subjectId)
    .all();
  return c.json({ mistakes: rows.results });
});

// Mistakes that are due for review now, oldest first.
mistakes.get("/due", async (c) => {
  const userId = c.get("userId");
  const rows = await c.env.DB
    .prepare(
      `SELECT id, subject_id, category, description, correction, review_stage, next_review_at
       FROM mistakes
       WHERE user_id = ? AND status != 'fixed' AND next_review_at IS NOT NULL AND next_review_at <= datetime('now')
       ORDER BY next_review_at ASC LIMIT 50`,
    )
    .bind(userId)
    .all();
  return c.json({ due: rows.results });
});

mistakes.patch("/:id/status", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const parsed = statusSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", "Choose a valid status.");
  await ownedMistake(c.env.DB, userId, id);
  await c.env.DB
    .prepare(`UPDATE mistakes SET status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
    .bind(parsed.data.status, id, userId)
    .run();
  return c.json({ ok: true });
});

// Records a review result and moves the mistake to its next spaced-repetition stage.
mistakes.post("/:id/review", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const parsed = reviewSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", "Choose got_it or still_struggling.");
  const m = await ownedMistake(c.env.DB, userId, id);
  const stageAfter = nextStage(m.review_stage, parsed.data.result);
  const due = nextReviewAt(stageAfter);
  const status = parsed.data.result === "got_it" && stageAfter === 5 ? "fixed" : "reviewing";
  await c.env.DB.batch([
    c.env.DB
      .prepare(`INSERT INTO reviews (user_id, mistake_id, result, stage_before, stage_after) VALUES (?, ?, ?, ?, ?)`)
      .bind(userId, id, parsed.data.result, m.review_stage, stageAfter),
    c.env.DB
      .prepare(`UPDATE mistakes SET review_stage = ?, next_review_at = ?, status = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`)
      .bind(stageAfter, due, status, id, userId),
  ]);
  return c.json({ review_stage: stageAfter, next_review_at: due, status });
});
