# ERD Studio server

The optional ERD Studio server provides shared project storage, editor/admin sessions, GitHub OAuth AI access, and AI provider routing. The supported topology is one Fastify process with one SQLite database.

## Authentication and project access

`POST /api/auth/login` accepts `{password}` over the same origin. A successful response contains only `{ok, role}` and sets an opaque editor-session cookie. The raw password is not a bearer token and is never returned. Session tokens are 256-bit random values; SQLite stores only their SHA-256 hashes. Sessions expire after 8 hours by default.

Project reads are private by default:

| Method | Path | Access |
|---|---|---|
| GET | `/healthz` | Anonymous |
| POST | `/api/auth/login` | Same-origin password login |
| GET | `/api/auth/me` | Anonymous session summary |
| POST | `/api/auth/editor/logout` | Same-origin editor-session logout |
| POST | `/api/auth/logout` | Same-origin full OAuth + editor logout |
| GET | `/api/projects` | Editor session, or anonymous when `PROJECT_READ_ACCESS=public` |
| GET | `/api/projects/:name` | Editor session, or anonymous when `PROJECT_READ_ACCESS=public` |
| PUT | `/api/projects/:name` | Same-origin editor/admin session |
| DELETE | `/api/projects/:name` | Same-origin editor/admin session |
| POST | `/api/ai/chat/completions` | Same-origin admin session or enabled OAuth AI grant; Codex remains local-admin only |

OAuth and editor sessions use separate cookies. The editor cookie is `erd-editor-session` for local HTTP development and `__Host-erd-editor-session` for secure production. The OAuth session cookie remains separate.

## Configuration

Copy `.env.example` to `.env` for local development and fill values locally.

| Variable | Default | Description |
|---|---|---|
| `EDIT_PASSWORD` | required | Instance-wide editor password |
| `ADMIN_PASSWORD` | unset | Separate admin password for self-hosted AI fallback |
| `PROJECT_READ_ACCESS` | `private` | `private` or explicit anonymous `public` reads |
| `EDITOR_SESSION_TTL_HOURS` | `8` | Editor/admin session lifetime; greater than 0 and at most 168 |
| `APP_BASE_URL` | request origin in development | Public origin; HTTPS is required in production |
| `COOKIE_SECURE` | `false` | Must be `true` in production |
| `DB_PATH` | `./erd.db` | SQLite database path |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `3001` | Listen port |
| `AI_PROVIDER` | `litellm` | `litellm` or loopback-only `codex` |
| `LITELLM_BASE_URL` | unset | OpenAI-compatible upstream |
| `LITELLM_API_KEY` | unset | Upstream credential |
| `LITELLM_MODEL` | unset | Optional server-enforced model |
| `CODEX_MODEL` | Codex default | Optional local subscription model |
| `GITHUB_OAUTH_CLIENT_ID` | unset | GitHub OAuth application ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | unset | GitHub OAuth secret |
| `LOG_LEVEL` | `info` | Fastify log level |

Production mode refuses to start unless `APP_BASE_URL` uses HTTPS and `COOKIE_SECURE=true`.

## Run and verify

```bash
cd server
npm ci
npm run dev

npm run typecheck
npm test
npm run build
```

For production, build first and run `node --enable-source-maps dist/index.js` as an unprivileged service user behind the nginx template in `deploy/nginx/erd.conf`.

## SQLite lifecycle

Startup creates the additive `editor_sessions` table and index with short `CREATE TABLE/INDEX IF NOT EXISTS` statements. No project rows are rewritten or backfilled. Rolling back to an older binary can leave the table in place without affecting project data; newly issued editor sessions will no longer be recognized. Remove the table only during an intentional offline cleanup.

Use SQLite's online backup mechanism for live backups, for example:

```bash
sqlite3 /var/lib/erd/erd.db ".backup '/secure-backups/erd.db'"
```

Restrict the database and environment file to the service account.
