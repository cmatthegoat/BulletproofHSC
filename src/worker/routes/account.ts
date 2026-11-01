import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "../errors";
import { verifyPassword } from "../crypto";
import { clearSessionCookie } from "../auth";
import { COURSE_TYPES } from "../../shared/study";
import { MISTAKE_CATEGORIES, SEVERITIES } from "../../shared/marking";
import type { Env, AppVariables } from "../env";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const account = new Hono<Ctx>();

const EXPORT_FORMAT = "study-backup";
const EXPORT_VERSION = 1;

const ref = z.number().int().positive();
const optRef = ref.nullable().default(null);
const text = (max: number) => z.string().max(max).default("");
const isoDate = z.string().max(40);

const backupSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  data: z.object({
    subjects: z
      .array(
        z.object({
          id: ref,
          name: z.string().trim().min(1).max(80),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
          course_type: z.enum(COURSE_TYPES),
          notes: text(5000),
          archived: z.union([z.literal(0), z.literal(1)]).default(0),
        }),
      )
      .max(500)
      .default([]),
    syllabus_points: z
      .array(
        z.object({
          id: ref,
          subject_id: ref,
          code: text(40),
          module: text(120),
          topic: text(120),
          description: text(2000),
          target_percentage: z.number().int().min(0).max(100).nullable().default(null),
          improvement_goal: text(2000),
        }),
      )
      .max(5000)
      .default([]),
    questions: z
      .array(
        z.object({
          id: ref,
          subject_id: ref,
          syllabus_point_id: optRef,
          source: text(200),
          question_text: z.string().min(1).max(10000),
          total_marks: z.number().int().min(1).max(1000),
          marking_criteria: text(10000),
          student_answer: text(20000),
        }),
      )
      .max(5000)
      .default([]),
    attempts: z
      .array(
        z.object({
          id: ref,
          question_id: ref,
          subject_id: ref,
          syllabus_point_id: optRef,
          marks_awarded: z.number().int().min(0),
          marks_total: z.number().int().min(1),
          percentage: z.number().min(0).max(100),
          result_json: z.string().max(100000).default("{}"),
        }),
      )
      .max(20000)
      .default([]),
    mistakes: z
      .array(
        z.object({
          id: ref,
          subject_id: ref,
          syllabus_point_id: optRef,
          category: z.enum(MISTAKE_CATEGORIES),
          description: z.string().min(1).max(2000),
          correction: text(4000),
          severity: z.enum(SEVERITIES),
          status: z.enum(["open", "reviewing", "fixed"]),
          repeat_count: z.number().int().min(1),
          review_stage: z.number().int().min(0),
          next_review_at: isoDate.nullable().default(null),
        }),
      )
      .max(20000)
      .default([]),
    mistake_occurrences: z
      .array(
        z.object({
          mistake_id: ref,
          question_id: optRef,
          attempt_id: optRef,
          description: z.string().min(1).max(2000),
          correction: text(4000),
          occurred_at: isoDate,
        }),
      )
      .max(50000)
      .default([]),
    reviews: z
      .array(
        z.object({
          mistake_id: ref,
          result: z.enum(["got_it", "still_struggling"]),
          stage_before: z.number().int().min(0),
          stage_after: z.number().int().min(0),
          reviewed_at: isoDate,
        }),
      )
      .max(50000)
      .default([]),
  }),
});

// Maps an id from the backup to the id of the row created for it in this account.
function mapRef(map: Map<number, number>, from: number | null, what: string): number | null {
  if (from === null) return null;
  const to = map.get(from);
  if (to === undefined) throw new AppError(400, "invalid_input", `The backup refers to a ${what} that is not in it.`);
  return to;
}

account.get("/export", async (c) => {
  const userId = c.get("userId");
  const all = (table: string) =>
    c.env.DB.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY id`).bind(userId).all();
  const [subjects, syllabus, questions, attempts, mistakes, occurrences, reviews] = await Promise.all([
    all("subjects"),
    all("syllabus_points"),
    all("questions"),
    all("attempts"),
    all("mistakes"),
    all("mistake_occurrences"),
    all("reviews"),
  ]);
  // user_id is left out: the backup belongs to whichever account imports it.
  const strip = (rows: Record<string, unknown>[]) =>
    rows.map(({ user_id: _unused, ...rest }) => rest);
  c.header("Cache-Control", "no-store");
  c.header("Content-Disposition", 'attachment; filename="study-backup.json"');
  return c.json({
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    data: {
      subjects: strip(subjects.results as Record<string, unknown>[]),
      syllabus_points: strip(syllabus.results as Record<string, unknown>[]),
      questions: strip(questions.results as Record<string, unknown>[]),
      attempts: strip(attempts.results as Record<string, unknown>[]),
      mistakes: strip(mistakes.results as Record<string, unknown>[]),
      mistake_occurrences: strip(occurrences.results as Record<string, unknown>[]),
      reviews: strip(reviews.results as Record<string, unknown>[]),
    },
  });
});

// Imports a backup into the signed-in account as new rows. Ids are remapped, and if any
// insert fails the subjects created so far are deleted, which cascades to everything under them.
account.post("/import", async (c) => {
  const userId = c.get("userId");
  const parsed = backupSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    throw new AppError(400, "invalid_input", "This file is not a valid study backup.");
  }
  const d = parsed.data.data;
  const db = c.env.DB;
  const createdSubjects: number[] = [];

  const subjectMap = new Map<number, number>();
  const syllabusMap = new Map<number, number>();
  const questionMap = new Map<number, number>();
  const attemptMap = new Map<number, number>();
  const mistakeMap = new Map<number, number>();

  try {
    for (const s of d.subjects) {
      const row = await db
        .prepare(
          `INSERT INTO subjects (user_id, name, color, course_type, notes, archived) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(userId, s.name, s.color, s.course_type, s.notes, s.archived)
        .first<{ id: number }>();
      if (!row) throw new Error("subject insert returned no row");
      createdSubjects.push(row.id);
      subjectMap.set(s.id, row.id);
    }

    for (const p of d.syllabus_points) {
      const subjectId = mapRef(subjectMap, p.subject_id, "subject")!;
      const row = await db
        .prepare(
          `INSERT INTO syllabus_points (user_id, subject_id, code, module, topic, description, target_percentage, improvement_goal)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(userId, subjectId, p.code, p.module, p.topic, p.description, p.target_percentage, p.improvement_goal)
        .first<{ id: number }>();
      if (!row) throw new Error("syllabus insert returned no row");
      syllabusMap.set(p.id, row.id);
    }

    for (const q of d.questions) {
      const row = await db
        .prepare(
          `INSERT INTO questions (user_id, subject_id, syllabus_point_id, source, question_text, total_marks, marking_criteria, student_answer)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          userId,
          mapRef(subjectMap, q.subject_id, "subject"),
          mapRef(syllabusMap, q.syllabus_point_id, "syllabus point"),
          q.source,
          q.question_text,
          q.total_marks,
          q.marking_criteria,
          q.student_answer,
        )
        .first<{ id: number }>();
      if (!row) throw new Error("question insert returned no row");
      questionMap.set(q.id, row.id);
    }

    for (const a of d.attempts) {
      const row = await db
        .prepare(
          `INSERT INTO attempts (user_id, question_id, subject_id, syllabus_point_id, marks_awarded, marks_total, percentage, result_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          userId,
          mapRef(questionMap, a.question_id, "question"),
          mapRef(subjectMap, a.subject_id, "subject"),
          mapRef(syllabusMap, a.syllabus_point_id, "syllabus point"),
          a.marks_awarded,
          a.marks_total,
          a.percentage,
          a.result_json,
        )
        .first<{ id: number }>();
      if (!row) throw new Error("attempt insert returned no row");
      attemptMap.set(a.id, row.id);
    }

    for (const m of d.mistakes) {
      const row = await db
        .prepare(
          `INSERT INTO mistakes (user_id, subject_id, syllabus_point_id, category, description, correction, severity, status, repeat_count, review_stage, next_review_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        )
        .bind(
          userId,
          mapRef(subjectMap, m.subject_id, "subject"),
          mapRef(syllabusMap, m.syllabus_point_id, "syllabus point"),
          m.category,
          m.description,
          m.correction,
          m.severity,
          m.status,
          m.repeat_count,
          m.review_stage,
          m.next_review_at,
        )
        .first<{ id: number }>();
      if (!row) throw new Error("mistake insert returned no row");
      mistakeMap.set(m.id, row.id);
    }

    for (const o of d.mistake_occurrences) {
      await db
        .prepare(
          `INSERT INTO mistake_occurrences (user_id, mistake_id, question_id, attempt_id, description, correction, occurred_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          userId,
          mapRef(mistakeMap, o.mistake_id, "mistake"),
          mapRef(questionMap, o.question_id, "question"),
          mapRef(attemptMap, o.attempt_id, "attempt"),
          o.description,
          o.correction,
          o.occurred_at,
        )
        .run();
    }

    for (const r of d.reviews) {
      await db
        .prepare(
          `INSERT INTO reviews (user_id, mistake_id, result, stage_before, stage_after, reviewed_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, mapRef(mistakeMap, r.mistake_id, "mistake"), r.result, r.stage_before, r.stage_after, r.reviewed_at)
        .run();
    }
  } catch (err) {
    if (err instanceof AppError) {
      await removeSubjects(db, userId, createdSubjects);
      throw err;
    }
    await removeSubjects(db, userId, createdSubjects);
    throw new AppError(500, "internal_error", "The backup could not be imported. Nothing was added.");
  }

  return c.json(
    {
      imported: {
        subjects: d.subjects.length,
        syllabus_points: d.syllabus_points.length,
        questions: d.questions.length,
        attempts: d.attempts.length,
        mistakes: d.mistakes.length,
      },
    },
    201,
  );
});

async function removeSubjects(db: D1Database, userId: number, subjectIds: number[]) {
  if (subjectIds.length === 0) return;
  await db.batch(
    subjectIds.map((id) => db.prepare(`DELETE FROM subjects WHERE id = ? AND user_id = ?`).bind(id, userId)),
  );
}

// Deleting the user removes every row they own through ON DELETE CASCADE, including sessions.
const deleteSchema = z.object({ password: z.string().min(1).max(256) });

account.delete("/", async (c) => {
  const userId = c.get("userId");
  const parsed = deleteSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", "Enter your password to delete the account.");
  const row = await c.env.DB
    .prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ password_hash: string; password_salt: string }>();
  if (!row) throw new AppError(404, "not_found", "Account not found.");
  const ok = await verifyPassword(parsed.data.password, row.password_hash, row.password_salt);
  if (!ok) throw new AppError(401, "invalid_credentials", "Password is incorrect.");
  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});
