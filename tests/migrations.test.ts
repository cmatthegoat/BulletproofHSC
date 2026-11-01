import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("migration 0001_init.sql", () => {
  const sql = readFileSync(resolve(__dirname, "../migrations/0001_init.sql"), "utf8");

  it("creates every table in the data model", () => {
    for (const t of [
      "users", "sessions", "rate_limits", "ai_usage", "subjects",
      "syllabus_points", "questions", "attempts", "mistakes",
      "mistake_occurrences", "reviews",
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE ${t} \\(`));
    }
  });

  it("scopes every user-owned table to user_id with a foreign key", () => {
    const owned = ["sessions", "ai_usage", "subjects", "syllabus_points", "questions", "attempts", "mistakes", "mistake_occurrences", "reviews"];
    for (const t of owned) {
      const block = sql.split(`CREATE TABLE ${t} (`)[1].split(");")[0];
      expect(block).toMatch(/user_id INTEGER NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
    }
  });
});
