# Changelog

All notable changes will be documented in this file. The project follows Semantic Versioning once stable API guarantees are introduced.

## 0.1.0-alpha.2 — 2026-11-01

### Added

- Back up changes that have not been saved to the server in the browser's IndexedDB, and offer to restore or discard them on the next visit. The backup is cleared after a successful server save. (#33)
- Korean translations of the README, contributing guide, code of conduct, security policy, and release guide. (#9)

### Fixed

- The lock toggle's accessible name now includes its visible status (Read only, Editing, Admin), fixing an axe label/content mismatch. (#28)

### Security

- Refreshed the transitive client `zod` to 4.6.7 for the High-severity GHSA-mrhx-c7xc-m3w5, and pinned a temporary `minimatch` 11.0.1 override for GHSA-g3hv-75wg-m249. (#28)
- Updated server `fast-uri` (3.1.9 and 4.2.3) and `ip-address` (10.7.5) for moderate advisories. (#31, #32)
- Cleared other dependency audit blockers and patched `source-map-js`. (#20, #24)

### Changed

- The offline status bar now reads `Local draft — kept in this browser` when browser storage is available. (#33)
- Updated client and server dependency groups, including React 19.3.1, Playwright 1.64.1, ESLint 10.13, Vitest 4.1.12, and `@openai/codex-sdk` 0.163.0.

## 0.1.0-alpha.1 — 2026-08-27

### Security

- Patched the High-severity transitive vulnerabilities in `brace-expansion`, `nanoid`, and `fast-uri`.
- Preserved High/Critical dependency audits, Gitleaks, and CodeQL as required release gates.

### Changed

- Updated the server dependency group, including Fastify and the OpenAI Codex SDK.
- Updated the client dependency group, including React, Playwright, axe-core, ESLint, and Vitest.

## 0.1.0-alpha.0 — 2026-08-01

### Added

- DDL import, visual ERD editing, Smart Merge, and PostgreSQL/MySQL/DBML/Mermaid/PNG/JSON export.
- Cookie-based editor/admin sessions with private project reads by default.
- Large-diagram entity navigator, semantic overview rendering, and property-panel column search.
- Optional Fastify/SQLite collaboration server, GitHub OAuth AI access, and loopback-only Codex provider.

### Security

- Removed reusable password bearer tokens and client-side editor token storage.
- Added same-origin enforcement for state-changing API requests and secure production cookie requirements.
- Store only a SHA-256 OAuth flow verifier in the browser cookie and rate-limit OAuth start/callback requests per app instance.
- Escape repeated DBML identifier/note delimiters and relation-preview separators before rendering generated output.
- Added High/Critical dependency audit gates and security scanning workflows.
