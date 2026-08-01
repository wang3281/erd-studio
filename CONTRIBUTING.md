# Contributing to ERD Studio

Thank you for helping improve ERD Studio. This project is currently an alpha, so focused bug fixes, parser compatibility improvements, accessibility work, and security hardening are especially useful.

## Before opening a change

- Search existing issues and keep one problem cluster per pull request.
- Do not include real schemas, passwords, tokens, customer data, or AI prompts in issues, fixtures, logs, or screenshots.
- For a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.
- Preserve existing project files and behavior unless the issue explicitly proposes a breaking change.

## Local checks

Use Node.js 20 or 22.

```bash
cd client
npm ci
npm run verify

cd ../server
npm ci
npm run typecheck
npm test
npm run build
```

Parser or Smart Merge changes should add a minimal regression test under `client/src/core/parser/__tests__` or `client/src/core/merge/__tests__`. Authentication and project-access changes must cover the relevant `401`, `403`, session expiry, logout, and same-origin cases.

## Pull requests

Describe the user-visible behavior, the verification commands you ran, and any limitations that remain. Keep generated files, local databases, browser artifacts, and unrelated formatting out of the change. Contributions are accepted under the repository's Apache-2.0 license.
