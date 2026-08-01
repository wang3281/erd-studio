# Internet deployment

ERD Studio's supported alpha deployment is a static Vite build and one Fastify/SQLite process behind an HTTPS reverse proxy.

1. Build `client/` and publish `client/dist/` as the nginx document root.
2. Build `server/` and run it as an unprivileged service on loopback.
3. Store the SQLite database outside the source tree with service-account-only permissions.
4. Set `NODE_ENV=production`, an HTTPS `APP_BASE_URL`, and `COOKIE_SECURE=true`.
5. Keep `PROJECT_READ_ACCESS=private` unless every saved schema is intentionally public.
6. Replace all placeholders in `nginx/erd.conf`, install a trusted certificate, run `nginx -t`, and only then reload nginx.

The nginx template adds HSTS, a restrictive CSP, frame blocking, content-type protection, and referrer/permissions policies. Review the CSP before adding third-party assets or analytics.

The repository does not include live infrastructure credentials or deployment evidence. Before making a private repository public, export a verified clean source tree as a new squash commit into a new public repository; do not expose the private repository's history. Inspect the archive for local databases, `.env` files, artifacts, personal harness files, and secrets before publishing it.
