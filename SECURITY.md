# Security Policy

## Supported versions

ERD Studio is pre-1.0 software. Only the latest published `0.1.x` alpha receives security fixes.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. If that feature is unavailable, contact the repository owner through the private contact method shown on the `@wang3281` GitHub profile. Do not include credentials, private ERD schemas, production database files, or AI prompts in a public issue.

We aim to acknowledge a complete report within 5 business days. Include the affected commit or version, reproduction conditions, likely impact, and a minimal proof of concept that does not contain real data.

## Security defaults

- Project list and schema reads are private unless `PROJECT_READ_ACCESS=public` is explicitly configured.
- Editor and admin passwords are exchanged only at same-origin login. Successful login creates an opaque, hashed, expiring server-side session and an HttpOnly `SameSite=Strict` cookie.
- Production requires an HTTPS `APP_BASE_URL` and `COOKIE_SECURE=true`.
- OAuth and editor sessions use separate cookies.
- Codex provider mode is loopback-only.

Treat ERD schemas and AI prompts as sensitive data. Terminate TLS at a trusted reverse proxy, restrict the SQLite file and environment file to the service account, rotate shared passwords, and back up SQLite using its online backup mechanism.

## Known alpha limitations

- Shared editor/admin passwords are instance-wide; this release has no per-user project ACL or audit attribution for editor actions.
- The supported topology is one Fastify process with one SQLite database. Horizontal scaling requires an external session and data store and is not supported.
- Local/offline drafts remain in browser memory until exported as JSON.
- The release lockfile resolves Vite 7.3.6 and patched `esbuild@0.28.1`. Development servers are still local tooling and must not be exposed to untrusted networks. Release CI audits the complete dependency trees.
