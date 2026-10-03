# Grantlane

Grantlane is a calm, local-first funding pipeline for small teams. It tracks grant opportunities
from first contact through submission and award, so nobody has to ask "where does this one stand?"
in a chat thread.

## Features

- **Pipeline dashboard** — total, active, and awarded application counts, pipeline value, due-soon
  count, and checklist completion rate from a single summary endpoint.
- **Stage tracking** — applications move through `prospecting`, `drafting`, `review`, `submitted`,
  `awarded`, and `declined`.
- **Search and filters** — case-insensitive search across title, funder, focus, and owner, plus
  stage filtering.
- **Application detail and checklists** — notes, deadlines, owners, and per-application tasks that
  can be added, toggled, and removed.
- **Activity feed** — every create, update, stage move, and checklist change is recorded with a
  timestamp.
- **Deterministic demo data** — the app boots with a fixed seed so screenshots, tests, and demos
  look the same on every machine.

## Stack

- **Frontend** — Preact 10 + Vite 7 (TypeScript, JSX automatic runtime, plain CSS)
- **Backend** — Hono 4 on `@hono/node-server`
- **Storage** — deterministic in-memory store (no database, no files)
- **Tooling** — TypeScript 5.9, tsx, Vitest 3, ESLint 9 (flat config), Prettier

## Storage model

Grantlane keeps every application, task, and activity entry in memory inside a single store. The
store is seeded from `src/server/seed.ts` when the process starts and **resets to that seed on every
restart** — there is no persistence layer, no migrations, and no external state. Tests call
`store.reset()` before each case to get the same deterministic starting point.

## Quick start

```bash
npm install
npm run build
npm start
```

The Hono server serves the built app and the API from one origin. Open
http://127.0.0.1:8787 and the health endpoint is at
http://127.0.0.1:8787/api/health.

Set `PORT` to run the server somewhere other than 8787:

```bash
PORT=9000 npm start
```

## Development workflow

```bash
npm install
npm run dev
```

`npm run dev` starts both processes with `concurrently`:

- **API** — `tsx watch src/server/index.ts` on http://127.0.0.1:8787 (restarts on server changes)
- **Web** — the Vite dev server on http://localhost:5173 with hot module replacement; `/api` is
  proxied to http://127.0.0.1:8787, so the client always talks to same-origin `/api` paths

Build and preview the production bundle with `npm run build` and `npm start`.

## Quality gates

| Command             | What it checks                                                          |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run lint`      | ESLint over the repo, then `prettier --check .`                         |
| `npm run typecheck` | `tsc --noEmit` across `src` and `tests` (strict, Preact JSX, Node/Vite) |
| `npm test -- --run` | Vitest in the Node environment, single run                              |
| `npm run build`     | Production Vite build into `dist/`                                      |

CI runs exactly these commands, then starts the server in the background and polls the health
endpoint at http://127.0.0.1:8787/api/health.

## API overview

All routes are JSON under `/api`; errors use `{ "error": "..." }` with a `400`, `404`, or `500`
status.

| Method   | Route                                 | Purpose                                                 |
| -------- | ------------------------------------- | ------------------------------------------------------- |
| `GET`    | `/api/health`                         | Service probe: `{ "ok": true, "service": "grantlane" }` |
| `GET`    | `/api/summary`                        | Pipeline totals, values, and stage counts               |
| `GET`    | `/api/applications?query=&stage=`     | List applications, optionally searched/filtered         |
| `POST`   | `/api/applications`                   | Create an application (`201` + `Location`)              |
| `GET`    | `/api/applications/:id`               | Fetch one application                                   |
| `PATCH`  | `/api/applications/:id`               | Update editable fields                                  |
| `DELETE` | `/api/applications/:id`               | Delete an application and its tasks                     |
| `POST`   | `/api/applications/:id/tasks`         | Add a checklist task (`{ "label": "..." }`)             |
| `PATCH`  | `/api/applications/:id/tasks/:taskId` | Toggle a task (`{ "done": true }`)                      |
| `DELETE` | `/api/applications/:id/tasks/:taskId` | Remove a checklist task                                 |
| `GET`    | `/api/activity?limit=&applicationId=` | Recent activity, capped at 100 entries                  |

## No external services

Grantlane runs entirely on your machine. It has no database, no hosted services, no API keys, and
no outbound network calls at runtime — only the npm packages needed to build and run it.

## License

MIT © 2026 Grantlane contributors — see [LICENSE](./LICENSE).
