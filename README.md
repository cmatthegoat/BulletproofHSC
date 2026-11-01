# Mistake Journal

A study tracker for HSC subjects: syllabus points, marked practice questions, and a log of recurring mistakes with spaced review. It runs as a Cloudflare Worker (Hono + D1) with a React client built by Vite.

## Setup

```bash
npm install
cp .dev.vars.example .dev.vars   # then set OPENROUTER_API_KEY in it
npm run db:migrate:local         # apply migrations to the local D1 database
```

Set `database_id` in `wrangler.toml` to your D1 database before deploying.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the Worker on port 8787 and the Vite client on port 5173 (proxies `/api`). |
| `npm run build` | Builds the client into `dist/`. |
| `npm test` | Runs the Vitest suite. |
| `npm run typecheck` | Type-checks the worker, client and tests. |
| `npm run db:migrate:remote` | Applies migrations to the remote D1 database. |
| `npm run deploy` | Builds the client and deploys the Worker with its assets. |

## Your data

- **Download backup** (in the app, or `GET /api/account/export`) returns a JSON file of your subjects, syllabus, questions, attempts, mistakes and reviews.
- **Import backup** adds that data to your account as new rows with new ids. If any row fails, nothing from that import is kept.
- **Delete account** removes your account and everything it owns. It asks for your password.
