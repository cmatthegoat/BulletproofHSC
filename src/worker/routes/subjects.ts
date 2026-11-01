import { Hono } from "hono";
import { subjectCreateSchema, subjectUpdateSchema } from "../../shared/study";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const subjects = new Hono<Ctx>();

// Returns the subject only if it belongs to the user. Every caller uses this for ownership.
export async function ownedSubject(db: D1Database, userId: number, id: number) {
  const row = await db
    .prepare(`SELECT id, name, color, course_type, notes, archived FROM subjects WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first();
  if (!row) throw new AppError(404, "not_found", "Subject not found.");
  return row;
}

subjects.get("/", async (c) => {
  const userId = c.get("userId");
  const rows = await c.env.DB
    .prepare(`SELECT id, name, color, course_type, notes, archived, created_at FROM subjects WHERE user_id = ? ORDER BY archived, name`)
    .bind(userId)
    .all();
  return c.json({ subjects: rows.results });
});

subjects.post("/", async (c) => {
  const userId = c.get("userId");
  const parsed = subjectCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  const row = await c.env.DB
    .prepare(`INSERT INTO subjects (user_id, name, color, course_type, notes) VALUES (?, ?, ?, ?, ?) RETURNING id`)
    .bind(userId, d.name, d.color, d.course_type, d.notes)
    .first<{ id: number }>();
  return c.json({ id: row?.id }, 201);
});

subjects.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  await ownedSubject(c.env.DB, userId, id);
  const parsed = subjectUpdateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new AppError(400, "invalid_input", parsed.error.issues[0].message);
  const d = parsed.data;
  // Only fields that were sent are changed; the rest keep their stored values.
  await c.env.DB
    .prepare(
      `UPDATE subjects SET
         name = COALESCE(?, name),
         color = COALESCE(?, color),
         course_type = COALESCE(?, course_type),
         notes = COALESCE(?, notes),
         archived = COALESCE(?, archived),
         updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(
      d.name ?? null,
      d.color ?? null,
      d.course_type ?? null,
      d.notes ?? null,
      d.archived === undefined ? null : d.archived ? 1 : 0,
      id,
      userId,
    )
    .run();
  return c.json({ ok: true });
});

subjects.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = Number(c.req.param("id"));
  await ownedSubject(c.env.DB, userId, id);
  // Deleting a subject cascades to its syllabus, questions and mistakes via foreign keys.
  await c.env.DB.prepare(`DELETE FROM subjects WHERE id = ? AND user_id = ?`).bind(id, userId).run();
  return c.json({ ok: true });
});
