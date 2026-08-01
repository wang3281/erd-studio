import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type {
  AuthenticatedUser,
  AuthStore,
  AIAccessGrantRow,
  EditorRole,
  EditorSessionRow,
  EditorSessionStore,
} from "./db.js";

declare module "fastify" {
  interface FastifyRequest {
    isEditor: boolean;
    isAdmin: boolean;
    currentUser: AuthenticatedUser | null;
    currentAIAccessGrant: AIAccessGrantRow | null;
  }
}

interface AuthOptions {
  editPassword: string;
  adminPassword?: string;
  authStore?: AuthStore;
  sessionCookieName?: string;
  editorSessionStore?: EditorSessionStore;
  editorSessionCookieName?: string;
  editorSessionTtlMs?: number;
  secureCookie?: boolean;
  appBaseUrl?: string;
  now?: () => Date;
}

export const DEFAULT_SESSION_COOKIE_NAME = "erd-session";
export const DEFAULT_EDITOR_SESSION_COOKIE_NAME = "erd-editor-session";
const DEFAULT_EDITOR_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

// HTTPS(secure cookie) 운영에서는 __Host- 프리픽스를 붙인다. 브라우저가
// Secure + Path=/ + Domain 없음 조건을 강제하므로, 서브도메인이나 비보안
// origin이 심은 동명 쿠키로 세션이 덮이는 것을 막는다. 평문 HTTP 로컬
// 개발에서는 프리픽스 없는 이름을 유지한다(브라우저가 거부하므로).
export function cookieNameFor(baseName: string, secureCookie: boolean | undefined): string {
  return secureCookie ? `__Host-${baseName}` : baseName;
}
const LOGIN_WINDOW_MS = 60_000;
const LOGIN_MAX_ATTEMPTS = 10;

// timing-safe 문자열 비교. 길이가 다르면 더미 비교를 한 번 돌려 길이 leak 도 최소화.
function constantTimeEquals(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

interface LoginRateLimiterOptions {
  windowMs: number;
  maxAttempts: number;
  /** 테스트에서 시간을 주입하기 위한 hook. 기본 Date.now. */
  now?: () => number;
}

// 다시 오지 않는 IP 의 만료 엔트리가 무한히 누적되지 않도록 정리(sweep)한다.
// 단 매 호출 전체 순회는 분산 폭주 시 O(N^2) 증폭 벡터가 되므로 윈도우당 1회로 게이트하고,
// 정확성(만료 후 재허용)은 키별 lazy 만료 검사로 보장해 check 를 평균 O(1) 로 유지한다.
export function createLoginRateLimiter({ windowMs, maxAttempts, now = Date.now }: LoginRateLimiterOptions) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  let nextSweepAt = 0;

  function sweepExpired(ts: number): void {
    if (ts < nextSweepAt) return;
    for (const [key, entry] of attempts) {
      if (ts > entry.resetAt) attempts.delete(key);
    }
    nextSweepAt = ts + windowMs;
  }

  function getActiveEntry(ip: string): { count: number; resetAt: number } | undefined {
    const ts = now();
    sweepExpired(ts);
    const entry = attempts.get(ip);
    if (!entry) return undefined;
    if (ts > entry.resetAt) {
      attempts.delete(ip);
      return undefined;
    }
    return entry;
  }

  function isBlocked(ip: string): boolean {
    const entry = getActiveEntry(ip);
    return !!entry && entry.count >= maxAttempts;
  }

  function check(ip: string): boolean {
    const ts = now();
    sweepExpired(ts);
    const entry = attempts.get(ip);
    if (!entry || ts > entry.resetAt) {
      attempts.set(ip, { count: 1, resetAt: ts + windowMs });
      return true;
    }
    if (entry.count >= maxAttempts) return false;
    entry.count += 1;
    return true;
  }

  function reset(ip: string): void {
    attempts.delete(ip);
  }

  return { check, isBlocked, reset, size: () => attempts.size };
}

export function createSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function parseCookieHeader(header: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      out.set(key, decodeURIComponent(value));
    } catch {
      out.set(key, value);
    }
  }
  return out;
}

export function serializeCookie(name: string, value: string, options: { maxAge?: number; httpOnly?: boolean; secure?: boolean; sameSite?: "Lax" | "Strict" | "None"; path?: string } = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly ?? true) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  return parts.join("; ");
}

export function isActiveAIAccessGrant(grant: AIAccessGrantRow | null, now = new Date()): boolean {
  if (!grant || grant.status !== "enabled") return false;
  if (!grant.expiresAt) return true;
  return Date.parse(grant.expiresAt) > now.getTime();
}

export function hasAIAccess(req: FastifyRequest): boolean {
  return req.isAdmin || isActiveAIAccessGrant(req.currentAIAccessGrant);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requestOrigin(req: FastifyRequest, appBaseUrl?: string): string {
  if (appBaseUrl) return new URL(appBaseUrl).origin;
  const proto = firstHeader(req.headers["x-forwarded-proto"]) ?? "http";
  const host = firstHeader(req.headers["x-forwarded-host"]) ?? req.headers.host ?? "127.0.0.1";
  return new URL(`${proto}://${host}`).origin;
}

function sourceOrigin(req: FastifyRequest): string | null {
  const origin = firstHeader(req.headers.origin);
  if (origin) return new URL(origin).origin;
  const referer = firstHeader(req.headers.referer);
  if (referer) return new URL(referer).origin;
  return null;
}

export function isSameOriginRequest(req: FastifyRequest, appBaseUrl?: string): boolean {
  try {
    const source = sourceOrigin(req);
    return !!source && source === requestOrigin(req, appBaseUrl);
  } catch {
    return false;
  }
}

export function ensureSameOriginRequest(req: FastifyRequest, reply: FastifyReply, appBaseUrl?: string): boolean {
  if (isSameOriginRequest(req, appBaseUrl)) return true;
  reply.code(403).send({ ok: false, error: "same-origin request required" });
  return false;
}

export function registerAuth(
  app: FastifyInstance,
  {
    editPassword,
    adminPassword,
    authStore,
    editorSessionStore = createMemoryEditorSessionStore(),
    secureCookie,
    sessionCookieName = cookieNameFor(DEFAULT_SESSION_COOKIE_NAME, secureCookie),
    editorSessionCookieName = cookieNameFor(DEFAULT_EDITOR_SESSION_COOKIE_NAME, secureCookie),
    editorSessionTtlMs = DEFAULT_EDITOR_SESSION_TTL_MS,
    appBaseUrl,
    now = () => new Date(),
  }: AuthOptions,
): void {
  const loginRateLimiter = createLoginRateLimiter({
    windowMs: LOGIN_WINDOW_MS,
    maxAttempts: LOGIN_MAX_ATTEMPTS,
  });
  app.decorateRequest("isEditor", false);
  app.decorateRequest("isAdmin", false);
  app.decorateRequest("currentUser", null);
  app.decorateRequest("currentAIAccessGrant", null);

  app.addHook("preHandler", async (req) => {
    req.isEditor = false;
    req.isAdmin = false;
    req.currentUser = null;
    req.currentAIAccessGrant = null;

    const cookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
    const cookies = parseCookieHeader(cookieHeader);
    const editorSessionToken = cookies.get(editorSessionCookieName);
    if (editorSessionToken) {
      const editorSession = editorSessionStore.getEditorSessionByHash(
        hashSessionToken(editorSessionToken),
        now().toISOString(),
      );
      if (editorSession) {
        req.isEditor = true;
        req.isAdmin = editorSession.role === "admin";
      }
    }

    if (!authStore) return;
    const sessionToken = cookies.get(sessionCookieName);
    if (!sessionToken) return;
    const user = authStore.getUserBySessionHash(hashSessionToken(sessionToken));
    if (!user) return;
    req.currentUser = user;
    req.currentAIAccessGrant = authStore.getAIAccessGrantForUser(user.id);
  });

  app.post("/auth/login", async (req, reply) => {
    if (!ensureSameOriginRequest(req, reply, appBaseUrl)) return;
    const body = req.body as { password?: unknown } | null;
    if (!body || typeof body.password !== "string") {
      return reply.code(400).send({ ok: false, error: "password required" });
    }
    if (loginRateLimiter.isBlocked(req.ip)) {
      return reply.code(429).send({ ok: false, error: "too many login attempts" });
    }
    let role: EditorRole | null = null;
    if (adminPassword && constantTimeEquals(body.password, adminPassword)) {
      loginRateLimiter.reset(req.ip);
      role = "admin";
    } else if (constantTimeEquals(body.password, editPassword)) {
      role = "editor";
    }
    if (role) {
      const token = createSessionToken();
      const expiresAt = new Date(now().getTime() + editorSessionTtlMs);
      editorSessionStore.createEditorSession(role, hashSessionToken(token), expiresAt.toISOString());
      reply.header("set-cookie", serializeCookie(editorSessionCookieName, token, {
        httpOnly: true,
        maxAge: Math.floor(editorSessionTtlMs / 1000),
        sameSite: "Strict",
        secure: secureCookie,
      }));
      return { ok: true, role };
    }
    if (!loginRateLimiter.check(req.ip)) {
      return reply.code(429).send({ ok: false, error: "too many login attempts" });
    }
    return reply.code(401).send({ ok: false, error: "invalid password" });
  });

  app.post("/auth/editor/logout", async (req, reply) => {
    if (!ensureSameOriginRequest(req, reply, appBaseUrl)) return;
    const cookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
    const token = parseCookieHeader(cookieHeader).get(editorSessionCookieName);
    if (token) editorSessionStore.deleteEditorSessionByHash(hashSessionToken(token));
    reply.header("set-cookie", serializeCookie(editorSessionCookieName, "", {
      httpOnly: true,
      maxAge: 0,
      sameSite: "Strict",
      secure: secureCookie,
    }));
    return { ok: true };
  });
}

function createMemoryEditorSessionStore(): EditorSessionStore {
  const sessions = new Map<string, EditorSessionRow>();
  return {
    createEditorSession(role, sessionHash, expiresAt) {
      const row = { id: `memory_${createSessionToken()}`, role, expiresAt };
      sessions.set(sessionHash, row);
      return row;
    },
    getEditorSessionByHash(sessionHash, nowIso = new Date().toISOString()) {
      const row = sessions.get(sessionHash);
      if (!row) return null;
      if (row.expiresAt <= nowIso) {
        sessions.delete(sessionHash);
        return null;
      }
      return row;
    },
    deleteEditorSessionByHash(sessionHash) {
      return sessions.delete(sessionHash);
    },
  };
}

export function ensureEditor(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.isEditor) {
    reply.code(401).send({ ok: false, error: "editor permission required" });
    return false;
  }
  return true;
}

export function ensureAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!req.isAdmin) {
    // 편집자 권한은 있지만 admin 이 아닌 경우는 403 (인증은 됐지만 권한 부족) 으로 구분.
    // 토큰 자체가 없는 경우는 401 — 클라이언트가 logout 으로 해석해야 함.
    const status = req.isEditor ? 403 : 401;
    reply.code(status).send({ ok: false, error: "admin permission required" });
    return false;
  }
  return true;
}

export function ensureAIAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.isAdmin) return true;
  if (!req.currentUser) {
    const status = req.isEditor ? 403 : 401;
    reply.code(status).send({ ok: false, error: req.isEditor ? "admin or AI access grant required" : "login required" });
    return false;
  }
  if (!isActiveAIAccessGrant(req.currentAIAccessGrant)) {
    reply.code(402).send({ ok: false, error: "AI access is not enabled for this account" });
    return false;
  }
  return true;
}
