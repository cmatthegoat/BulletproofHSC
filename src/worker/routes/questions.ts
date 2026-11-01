import { Hono } from "hono";
import { questionCreateSchema, questionUpdateSchema } from "../../shared/marking";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";
import { ownedSubject } from "./subjects";
import { recordMistake } from "./mistakes";
import { chatCompletion } from "../openrouter";
import {
  buildMarkingMessages,
  clampResult,
  parseMarkingReply,
  releaseAiCall,
  reserveAiCall,
} from "../marking";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const questions = new Hono<Ctx>();

// Confirms the question belongs to the caller. Returns it, or throws 404.
async function ownedQuestion(db: D1Database, userId: number, id: number) {
  const row = await db
    .prepare(
      `SELECT id, subject_id, syllabus_point_id, source, question_text, total_marks,
              marking_criteria, student_answer, created_at, updated_at
       FROM questions WHERE id = ? AND user_id = ?`,
    )
    .bind(id, userId)
    .first<{
      id: number;
      subject_id: number;
      syllabus_point_id: number | null;
      source: string;
      question_text: string;
      total_marks: number;
      marking_criteria: string;
      student_answer: string;
    }>();
  if (!row) throw new AppError(404, "not_found", "Question not found.");
  return row;
}

questions.get("/", async (c) => {
  const userId = c.get("userId");
  const subjectId = Number(c.req.query("subject_id"));
  if (!Number.isInteger(subjectId) || subjectId <= 0) throw new AppError(400, "invalid_input", "Choose a subject.");
  await ownedSubject(c.env.DB, userId, subjectId);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, subject_id, syllabus_point_id, source, question_text, total_marks, created_at, updated_at
       FROM questions WHERE user_id = ? AND subject_id = ? ORDER BY id DESC`,
    )
    .bind(userId, subjectId)
    .all();
  return c.json({ questions: rows.results });
});

questions.get("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) throw new AppError(404, "not_found", "Question not found.");
  const q = await ownedQuestion(c.env.DB, userId, id);
  const attempts = await c.env.DB
    .prepare(
      `SELECT id, marks_awarded, marks_total, percentage, result_json, created_at
       FROM attempts WHERE question_id = ? AND user_id = ? ORDER BY id DESC`,
    )
    .bind(id, userId)
    .all();
  return c.json({ question: q, attempts: attempts.results });
});

questions.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = questionCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  await ownedSubject(c.env.DB, userId, d.subject_id);
  if (d.syllabus_point_id !== null) {
    const point = await c.env.DB
      .prepare(`SELECT id FROM syllabus_points WHERE id = ? AND user_id = ? AND subject_id = ?`)
      .bind(d.syllabus_point_id, userId, d.subject_id)
      .first();
    if (!point) throw new AppError(400, "invalid_input", "That syllabus point is not in this subject.");
  }
  const row = await c.env.DB
    .prepare(
      `INSERT INTO questions (user_id, subject_id, syllabus_point_id, source, question_text, total_marks, marking_criteria, student_answer)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(userId, d.subject_id, d.syllabus_point_id, d.source, d.question_text, d.total_marks, d.marking_criteria, d.student_answer)
    .first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

questions.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const parsed = questionUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const current = await ownedQuestion(c.env.DB, userId, id);
  const d = parsed.data;
  const next = {
    syllabus_point_id: "syllabus_point_id" in d ? d.syllabus_point_id : current.syllabus_point_id,
    source: d.source ?? current.source,
    question_text: d.question_text ?? current.question_text,
    total_marks: d.total_marks ?? current.total_marks,
    marking_criteria: d.marking_criteria ?? current.marking_criteria,
    student_answer: d.student_answer ?? current.student_answer,
  };
  if (next.syllabus_point_id !== null) {
    const point = await c.env.DB
      .prepare(`SELECT id FROM syllabus_points WHERE id = ? AND user_id = ? AND subject_id = ?`)
      .bind(next.syllabus_point_id, userId, current.subject_id)
      .first();
    if (!point) throw new AppError(400, "invalid_input", "That syllabus point is not in this subject.");
  }
  await c.env.DB
    .prepare(
      `UPDATE questions SET syllabus_point_id = ?, source = ?, question_text = ?, total_marks = ?,
         marking_criteria = ?, student_answer = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(next.syllabus_point_id, next.source, next.question_text, next.total_marks, next.marking_criteria, next.student_answer, id, userId)
    .run();
  return c.json({ ok: true });
});

questions.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const result = await c.env.DB
    .prepare(`DELETE FROM questions WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  if (!result.meta.changes) throw new AppError(404, "not_found", "Question not found.");
  return c.json({ ok: true });
});

// Marks the saved answer with AI. Reserves one daily call first and releases it if the AI fails.
questions.post("/:id/mark", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const q = await ownedQuestion(c.env.DB, userId, id);
  if (!q.student_answer.trim()) throw new AppError(400, "invalid_input", "Write the answer before marking it.");

  await reserveAiCall(c.env.DB, c.env, userId);
  let result;
  try {
    const first = parseMarkingReply(await chatCompletion(c.env, buildMarkingMessages({
      questionText: q.question_text,
      totalMarks: q.total_marks,
      criteria: q.marking_criteria,
      answer: q.student_answer,
      strict: false,
    })));
    const reply = first ?? parseMarkingReply(await chatCompletion(c.env, buildMarkingMessages({
      questionText: q.question_text,
      totalMarks: q.total_marks,
      criteria: q.marking_criteria,
      answer: q.student_answer,
      strict: true,
    })));
    if (!reply) throw new AppError(502, "ai_bad_format", "The AI could not mark this answer in the expected format. Please try again.");
    result = clampResult(reply, q.total_marks);
  } catch (err) {
    await releaseAiCall(c.env.DB, userId);
    throw err;
  }

  const attempt = await c.env.DB
    .prepare(
      `INSERT INTO attempts (user_id, question_id, subject_id, syllabus_point_id, marks_awarded, marks_total, percentage, result_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(userId, id, q.subject_id, q.syllabus_point_id, result.marks_awarded, result.marks_total, result.percentage, JSON.stringify(result))
    .first<{ id: number }>();
  for (const m of result.mistakes) {
    await recordMistake(c.env.DB, userId, {
      subject_id: q.subject_id,
      syllabus_point_id: q.syllabus_point_id,
      category: m.category,
      description: m.description,
      correction: m.correction,
      severity: m.severity,
      question_id: id,
      attempt_id: attempt?.id ?? null,
    });
  }
  return c.json({ attempt_id: attempt?.id, result }, 201);
});
