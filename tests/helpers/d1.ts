// Test-only D1 shim over Node's built-in SQLite. It runs the same migrations and
// prepared-statement API the Worker uses, so route tests exercise real SQL.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type Row = Record<string, unknown>;

function wrap(db: DatabaseSync) {
  const prepare = (sql: string) => {
    const stmt = db.prepare(sql);
    let params: unknown[] = [];
    const api = {
      bind(...values: unknown[]) {
        params = values;
        return api;
      },
      async first<T = Row>(): Promise<T | null> {
        const row = stmt.get(...(params as never[]));
        return (row as T | undefined) ?? null;
      },
      async all<T = Row>() {
        return { results: stmt.all(...(params as never[])) as T[] };
      },
      async run() {
        const info = stmt.run(...(params as never[]));
        return { success: true, meta: { changes: info.changes, last_row_id: info.lastInsertRowid } };
      },
    };
    return api;
  };
  return {
    prepare,
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      return out;
    },
    exec: (sql: string) => db.exec(sql),
  };
}

export function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  const dir = resolve(__dirname, "../../migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(resolve(dir, file), "utf8"));
  }
  return wrap(db) as unknown as D1Database;
}
