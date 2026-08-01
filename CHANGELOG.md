# Changelog

All notable changes will be documented in this file. The project follows Semantic Versioning once stable API guarantees are introduced.

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
