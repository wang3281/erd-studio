# Public alpha release

The current development repository may contain private history and local-only tooling. Do not make that repository public in place.

## Source-only squash import

1. Complete the client/server verification and High/Critical audits documented in the root README.
2. Build a source archive from the verified working tree using only tracked and explicitly reviewed public files. Exclude `.git`, `.env*`, databases, `artifacts/`, `node_modules/`, build output, editor state, private harness files, and credentials.
3. Inspect the archive file list and run secret scanning against the extracted archive.
4. Create a new empty private repository for the final pre-public verification.
5. Extract the verified archive into a fresh directory, initialize a new Git repository, and create one initial release commit.
6. Enable CI, Dependabot, and secret scanning. Resolve or close failed update pull requests before changing visibility.
7. Change the verified repository to public, enable branch protection, and run the public-only CodeQL workflow.
8. Tag `v0.1.0-alpha.0` only after the required checks and CodeQL analysis pass.

Keep the private repository and its history private. The source archive and its checksum are the handoff boundary; do not copy `.git` objects or use a mirror push.

## Release blockers

Do not release with a High/Critical dependency or security finding, a failed product test/build, an unresolved Smart Merge data-loss bug, a secret-scan finding, or a missing license/security-reporting path.
