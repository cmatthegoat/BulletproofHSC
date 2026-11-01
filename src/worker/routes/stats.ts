import { Hono } from "hono";
import { AppError } from "../errors";
import type { Env, AppVariables } from "../env";
import { ownedSubject } from "./subjects";

type Ctx = { Bindings: Env; Variables: AppVariables };
export const stats = new Hono<Ctx>();

// Average percentage per subject, most recent attempts first for trends.
// Every query is scoped to the caller's user_id.
stats.get("/", async (c) => {
  const userId = c.get("userId");
  const subjectFilter = c.req.query("subject_id");
  let subjectId: number | null = null;
  if (subjectFilter !== undefined) {
    subjectId = Number(subjectFilter);
    if (!Number.isInteger(subjectId) || subjectId <= 0) throw new AppError(400, "invalid_input", "Choose a valid subject.");
    await ownedSubject(c.env.DB, userId, subjectId);
  }
  const subjectClause = subjectId === null ? "" : " AND a.subject_id = ?";
  const binds = subjectId === null ? [userId] : [userId, subjectId];

  const bySubject = await c.env.DB
    .prepare(
      `SELECT s.id AS subject_id, s.name, s.color,
              COUNT(a.id) AS attempts,
              ROUND(AVG(a.percentage), 1) AS average_percentage
       FROM subjects s
       LEFT JOIN attempts a ON a.subject_id = s.id AND a.user_id = s.user_id
       WHERE s.user_id = ? AND s.archived = 0${subjectId === null ? "" : " AND s.id = ?"}
       GROUP BY s.id
       ORDER BY s.name`,
    )
    .bind(...binds)
    .all();

  const trend = await c.env.DB
    .prepare(
      `SELECT date(a.created_at) AS day, ROUND(AVG(a.percentage), 1) AS average_percentage, COUNT(*) AS attempts
       FROM attempts a
       WHERE a.user_id = ?${subjectClause}
       GROUP BY date(a.created_at)
       ORDER BY day DESC LIMIT 30`,
    )
    .bind(...binds)
    .all();

  // Improvement areas: syllabus points with the lowest average among attempts, then open mistakes.
  const weakPoints = await c.env.DB
    .prepare(
      `SELECT sp.id AS syllabus_point_id, sp.code, sp.topic, sp.subject_id,
              COUNT(a.id) AS attempts,
              ROUND(AVG(a.percentage), 1) AS average_percentage
       FROM attempts a
       JOIN syllabus_points sp ON sp.id = a.syllabus_point_id AND sp.user_id = a.user_id
       WHERE a.user_id = ?${subjectClause}
       GROUP BY sp.id
       HAVING COUNT(a.id) >= 1
       ORDER BY average_percentage ASC LIMIT 5`,
    )
    .bind(...binds)
    .all();

  const openMistakes = await c.env.DB
    .prepare(
      `SELECT category, COUNT(*) AS count, SUM(repeat_count) AS repeats
       FROM mistakes
       WHERE user_id = ? AND status != 'fixed'${subjectId === null ? "" : " AND subject_id = ?"}
       GROUP BY category
       ORDER BY repeats DESC`,
    )
    .bind(...(subjectId === null ? [userId] : [userId, subjectId]))
    .all();

  return c.json({
    by_subject: bySubject.results,
    trend: trend.results.reverse(),
    weak_points: weakPoints.results,
    open_mistakes_by_category: openMistakes.results,
  });
});
