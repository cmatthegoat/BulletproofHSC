import { Hono } from "hono";
import { syllabusCreateSchema, syllabusUpdateSchema, syllabusBulkSchema, syllabusParseRequestSchema } from "../../shared/study";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";
import { ownedSubject } from "./subjects";
import { buildSyllabusMessages, parseSyllabusReply } from "../syllabus-parser";
import { chatCompletion } from "../openrouter";
import { requireAiSettings } from "../ai-settings";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const syllabus = new Hono<Ctx>();

syllabus.get("/", async (c) => {
  const userId = c.get("userId");
  const subjectId = Number(c.req.query("subject_id"));
  if (!Number.isInteger(subjectId) || subjectId <= 0) throw new AppError(400, "invalid_input", "Choose a subject.");
  await ownedSubject(c.env.DB, userId, subjectId);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, subject_id, code, module, topic, description, target_percentage, improvement_goal
       FROM syllabus_points WHERE user_id = ? AND subject_id = ? ORDER BY module, code, id`,
    )
    .bind(userId, subjectId)
    .all();
  return c.json({ points: rows.results });
});

syllabus.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = syllabusCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  await ownedSubject(c.env.DB, userId, d.subject_id);
  const row = await c.env.DB
    .prepare(
      `INSERT INTO syllabus_points (user_id, subject_id, code, module, topic, description)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .bind(userId, d.subject_id, d.code, d.module, d.topic, d.description)
    .first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

// Saves points the user has reviewed in the UI. This is the only path that stores AI output.
syllabus.post("/bulk", async (c) => {
  const userId = c.get("userId");
  const parsed = syllabusBulkSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  await ownedSubject(c.env.DB, userId, parsed.data.subject_id);
  const stmts = parsed.data.points.map((p) =>
    c.env.DB
      .prepare(
        `INSERT INTO syllabus_points (user_id, subject_id, code, module, topic, description) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(userId, parsed.data.subject_id, p.code, p.module, p.topic, p.description),
  );
  await c.env.DB.batch(stmts);
  return c.json({ saved: stmts.length }, 201);
});

// Returns a draft for review. Nothing is saved here.
syllabus.post("/parse", async (c) => {
  const parsed = syllabusParseRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const text = parsed.data.text;

  const settings = await requireAiSettings(c.env, c.get("userId"));
  const first = parseSyllabusReply(await chatCompletion(settings, buildSyllabusMessages(text, false)));
  if (first) return c.json({ draft: first });

  const retry = parseSyllabusReply(await chatCompletion(settings, buildSyllabusMessages(text, true)));
  if (retry) return c.json({ draft: retry });

  throw new AppError(502, "ai_bad_format", "The AI could not structure that text. Try a shorter extract, or add the points by hand.");
});

syllabus.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const parsed = syllabusUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  const result = await c.env.DB
    .prepare(
      `UPDATE syllabus_points SET
         code = COALESCE(?, code),
         module = COALESCE(?, module),
         topic = COALESCE(?, topic),
         description = COALESCE(?, description)
       WHERE id = ? AND user_id = ?`,
    )
    .bind(d.code ?? null, d.module ?? null, d.topic ?? null, d.description ?? null, id, userId)
    .run();
  if (!result.meta.changes) throw new AppError(404, "not_found", "Syllabus point not found.");
  return c.json({ ok: true });
});

syllabus.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  const result = await c.env.DB
    .prepare(`DELETE FROM syllabus_points WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .run();
  if (!result.meta.changes) throw new AppError(404, "not_found", "Syllabus point not found.");
  return c.json({ ok: true });
});
