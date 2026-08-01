import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

export interface ProjectMetaRow {
  name: string;
  updatedAt: string;
  version: number;
}

export interface ProjectRow extends ProjectMetaRow {
  schemaJson: string;
}

export type UpsertProjectResult =
  | { ok: true; updatedAt: string; version: number }
  | { ok: false; currentUpdatedAt: string | null; currentVersion: number | null };

export type AIAccessGrantStatus = "enabled" | "disabled";

export interface AuthenticatedUser {
  id: string;
  provider: string;
  providerUserId: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface UpsertOAuthUserInput {
  provider: string;
  providerUserId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  expiresAt: string;
}

export type EditorRole = "editor" | "admin";

export interface EditorSessionRow {
  id: string;
  role: EditorRole;
  expiresAt: string;
}

export interface EditorSessionStore {
  createEditorSession(role: EditorRole, sessionHash: string, expiresAt: string): EditorSessionRow;
  getEditorSessionByHash(sessionHash: string, nowIso?: string): EditorSessionRow | null;
  deleteEditorSessionByHash(sessionHash: string): boolean;
}

export interface AIAccessGrantRow {
  id: string;
  userId: string;
  provider: string;
  providerGrantId: string | null;
  status: AIAccessGrantStatus;
  label: string;
  expiresAt: string | null;
  updatedAt: string;
}

export interface AuthStore {
  upsertOAuthUser(input: UpsertOAuthUserInput): AuthenticatedUser;
  createOAuthState(stateHash: string, expiresAt: string): void;
  consumeOAuthState(stateHash: string, nowIso: string): boolean;
  createSession(userId: string, sessionHash: string, expiresAt: string): SessionRow;
  getUserBySessionHash(sessionHash: string, nowIso?: string): AuthenticatedUser | null;
  deleteSessionByHash(sessionHash: string): boolean;
  getAIAccessGrantForUser(userId: string): AIAccessGrantRow | null;
  setAIAccessGrant(row: Omit<AIAccessGrantRow, "id" | "updatedAt">): AIAccessGrantRow;
}

export interface ProjectStore {
  listProjects(): ProjectMetaRow[];
  getProject(name: string): ProjectRow | null;
  upsertProject(name: string, schemaJson: string, expectedValidator?: string): UpsertProjectResult;
  deleteProject(name: string): boolean;
}

export interface DB extends AuthStore, EditorSessionStore, ProjectStore {
}

export function initDb(dbPath: string): DB {
  const dir = dirname(dbPath);
  if (dir && dir !== "." && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      schema_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      version INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      email TEXT,
      display_name TEXT,
      avatar_url TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(provider, provider_user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS editor_sessions (
      id TEXT PRIMARY KEY,
      session_hash TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS oauth_states (
      state_hash TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_access_grants (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_grant_id TEXT,
      status TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'default',
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      UNIQUE(user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_hash ON sessions(session_hash);
    CREATE INDEX IF NOT EXISTS idx_editor_sessions_hash ON editor_sessions(session_hash);
    CREATE INDEX IF NOT EXISTS idx_ai_access_grants_user ON ai_access_grants(user_id);
  `);

  const hasLegacySubscriptions = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'`).get();
  if (hasLegacySubscriptions) {
    db.exec(`
      INSERT OR IGNORE INTO ai_access_grants (
        id, user_id, provider, provider_grant_id, status, label, expires_at, created_at, updated_at
      )
      SELECT
        'grant_' || substr(id, 5),
        user_id,
        provider,
        provider_subscription_id,
        CASE WHEN status IN ('active', 'trialing') THEN 'enabled' ELSE 'disabled' END,
        tier,
        current_period_end,
        created_at,
        updated_at
      FROM subscriptions
    `);
  }

  try {
    db.exec(`ALTER TABLE projects ADD COLUMN version INTEGER NOT NULL DEFAULT 1`);
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes("duplicate column")) throw err;
  }

  const listStmt = db.prepare(
    `SELECT name, updated_at AS updatedAt, version FROM projects ORDER BY updated_at DESC`,
  );
  const getStmt = db.prepare(
    `SELECT name, schema_json AS schemaJson, updated_at AS updatedAt, version
       FROM projects WHERE name = ?`,
  );
  const upsertStmt = db.prepare(`
    INSERT INTO projects (name, schema_json, updated_at, version)
    VALUES (@name, @schemaJson, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1)
    ON CONFLICT(name) DO UPDATE SET
      schema_json = excluded.schema_json,
      updated_at  = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      version     = projects.version + 1
  `);
  const updatedAtStmt = db.prepare(
    `SELECT updated_at AS updatedAt, version FROM projects WHERE name = ?`,
  );
  const upsertWithExpected = db.transaction((name: string, schemaJson: string, expectedValidator?: string): UpsertProjectResult => {
    if (expectedValidator !== undefined) {
      const current = updatedAtStmt.get(name) as { updatedAt: string; version: number } | undefined;
      const currentValidator = current ? `${current.updatedAt}:${current.version}` : null;
      if (currentValidator !== expectedValidator) {
        return {
          ok: false,
          currentUpdatedAt: current?.updatedAt ?? null,
          currentVersion: current?.version ?? null,
        };
      }
    }

    upsertStmt.run({ name, schemaJson });
    const row = updatedAtStmt.get(name) as { updatedAt: string; version: number };
    return { ok: true, updatedAt: row.updatedAt, version: row.version };
  });
  const deleteStmt = db.prepare(`DELETE FROM projects WHERE name = ?`);

  const selectUserStmt = db.prepare(`
    SELECT id, provider, provider_user_id AS providerUserId, email, display_name AS displayName, avatar_url AS avatarUrl
      FROM users WHERE provider = ? AND provider_user_id = ?
  `);
  const getUserByIdStmt = db.prepare(`
    SELECT id, provider, provider_user_id AS providerUserId, email, display_name AS displayName, avatar_url AS avatarUrl
      FROM users WHERE id = ?
  `);
  const insertUserStmt = db.prepare(`
    INSERT INTO users (id, provider, provider_user_id, email, display_name, avatar_url)
    VALUES (@id, @provider, @providerUserId, @email, @displayName, @avatarUrl)
  `);
  const updateUserStmt = db.prepare(`
    UPDATE users
       SET email = @email,
           display_name = @displayName,
           avatar_url = @avatarUrl,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = @id
  `);
  const createSessionStmt = db.prepare(`
    INSERT INTO sessions (id, user_id, session_hash, expires_at)
    VALUES (@id, @userId, @sessionHash, @expiresAt)
  `);
  const createOAuthStateStmt = db.prepare(`
    INSERT OR REPLACE INTO oauth_states (state_hash, expires_at)
    VALUES (?, ?)
  `);
  const consumeOAuthStateStmt = db.prepare(`
    DELETE FROM oauth_states WHERE state_hash = ? AND expires_at > ?
  `);
  const deleteExpiredOAuthStatesStmt = db.prepare(`DELETE FROM oauth_states WHERE expires_at <= ?`);
  const getSessionUserStmt = db.prepare(`
    SELECT u.id, u.provider, u.provider_user_id AS providerUserId, u.email, u.display_name AS displayName, u.avatar_url AS avatarUrl
      FROM sessions s
      JOIN users u ON u.id = s.user_id
     WHERE s.session_hash = ? AND s.expires_at > ?
  `);
  const touchSessionStmt = db.prepare(`
    UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE session_hash = ?
  `);
  const deleteExpiredSessionsStmt = db.prepare(`DELETE FROM sessions WHERE expires_at <= ?`);
  const deleteSessionStmt = db.prepare(`DELETE FROM sessions WHERE session_hash = ?`);
  const createEditorSessionStmt = db.prepare(`
    INSERT INTO editor_sessions (id, session_hash, role, expires_at)
    VALUES (@id, @sessionHash, @role, @expiresAt)
  `);
  const getEditorSessionStmt = db.prepare(`
    SELECT id, role, expires_at AS expiresAt
      FROM editor_sessions
     WHERE session_hash = ? AND expires_at > ?
  `);
  const touchEditorSessionStmt = db.prepare(`
    UPDATE editor_sessions
       SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE session_hash = ?
  `);
  const deleteExpiredEditorSessionsStmt = db.prepare(`DELETE FROM editor_sessions WHERE expires_at <= ?`);
  const deleteEditorSessionStmt = db.prepare(`DELETE FROM editor_sessions WHERE session_hash = ?`);
  const getAIAccessGrantStmt = db.prepare(`
    SELECT id, user_id AS userId, provider, provider_grant_id AS providerGrantId,
           status, label, expires_at AS expiresAt, updated_at AS updatedAt
      FROM ai_access_grants WHERE user_id = ?
  `);
  const upsertAIAccessGrantStmt = db.prepare(`
    INSERT INTO ai_access_grants (
      id, user_id, provider, provider_grant_id, status, label, expires_at, updated_at
    ) VALUES (
      @id, @userId, @provider, @providerGrantId, @status, @label, @expiresAt,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(user_id) DO UPDATE SET
      provider = excluded.provider,
      provider_grant_id = excluded.provider_grant_id,
      status = excluded.status,
      label = excluded.label,
      expires_at = excluded.expires_at,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);

  function normalizeUser(row: unknown): AuthenticatedUser {
    const user = row as AuthenticatedUser;
    return {
      id: user.id,
      provider: user.provider,
      providerUserId: user.providerUserId,
      email: user.email ?? null,
      displayName: user.displayName ?? null,
      avatarUrl: user.avatarUrl ?? null,
    };
  }

  function getAIAccessGrant(userId: string): AIAccessGrantRow | null {
    const row = getAIAccessGrantStmt.get(userId) as AIAccessGrantRow | undefined;
    return row ?? null;
  }

  return {
    upsertOAuthUser(input) {
      const existing = selectUserStmt.get(input.provider, input.providerUserId) as AuthenticatedUser | undefined;
      if (existing) {
        updateUserStmt.run({
          id: existing.id,
          email: input.email === undefined ? existing.email : input.email,
          displayName: input.displayName ?? null,
          avatarUrl: input.avatarUrl ?? null,
        });
        return normalizeUser(getUserByIdStmt.get(existing.id));
      }
      const id = `usr_${randomUUID()}`;
      insertUserStmt.run({
        id,
        provider: input.provider,
        providerUserId: input.providerUserId,
        email: input.email ?? null,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
      });
      return normalizeUser(getUserByIdStmt.get(id));
    },
    createOAuthState(stateHash, expiresAt) {
      deleteExpiredOAuthStatesStmt.run(new Date().toISOString());
      createOAuthStateStmt.run(stateHash, expiresAt);
    },
    consumeOAuthState(stateHash, nowIso) {
      const info = consumeOAuthStateStmt.run(stateHash, nowIso);
      deleteExpiredOAuthStatesStmt.run(nowIso);
      return info.changes === 1;
    },
    createSession(userId, sessionHash, expiresAt) {
      deleteExpiredSessionsStmt.run(new Date().toISOString());
      const id = `sess_${randomUUID()}`;
      createSessionStmt.run({ id, userId, sessionHash, expiresAt });
      return { id, userId, expiresAt };
    },
    getUserBySessionHash(sessionHash, nowIso = new Date().toISOString()) {
      const row = getSessionUserStmt.get(sessionHash, nowIso);
      if (!row) return null;
      touchSessionStmt.run(sessionHash);
      return normalizeUser(row);
    },
    deleteSessionByHash(sessionHash) {
      const info = deleteSessionStmt.run(sessionHash);
      return info.changes > 0;
    },
    createEditorSession(role, sessionHash, expiresAt) {
      deleteExpiredEditorSessionsStmt.run(new Date().toISOString());
      const id = `edit_sess_${randomUUID()}`;
      createEditorSessionStmt.run({ id, role, sessionHash, expiresAt });
      return { id, role, expiresAt };
    },
    getEditorSessionByHash(sessionHash, nowIso = new Date().toISOString()) {
      const row = getEditorSessionStmt.get(sessionHash, nowIso) as EditorSessionRow | undefined;
      if (!row) return null;
      touchEditorSessionStmt.run(sessionHash);
      return row;
    },
    deleteEditorSessionByHash(sessionHash) {
      const info = deleteEditorSessionStmt.run(sessionHash);
      return info.changes > 0;
    },
    getAIAccessGrantForUser(userId) {
      return getAIAccessGrant(userId);
    },
    setAIAccessGrant(row) {
      const id = `grant_${randomUUID()}`;
      upsertAIAccessGrantStmt.run({
        id,
        userId: row.userId,
        provider: row.provider,
        providerGrantId: row.providerGrantId ?? null,
        status: row.status,
        label: row.label,
        expiresAt: row.expiresAt ?? null,
      });
      return getAIAccessGrant(row.userId)!;
    },
    listProjects() {
      return listStmt.all() as ProjectMetaRow[];
    },
    getProject(name) {
      const row = getStmt.get(name) as ProjectRow | undefined;
      return row ?? null;
    },
    upsertProject(name, schemaJson, expectedValidator) {
      return upsertWithExpected(name, schemaJson, expectedValidator);
    },
    deleteProject(name) {
      const info = deleteStmt.run(name);
      return info.changes > 0;
    },
  };
}
