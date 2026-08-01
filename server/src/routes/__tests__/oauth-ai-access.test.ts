import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth, hashSessionToken } from "../../auth.js";
import { registerAIRoutes } from "../ai.js";
import { registerOAuthRoutes } from "../oauth.js";
import { initDb } from "../../db.js";
import type { AuthStore, AuthenticatedUser, AIAccessGrantRow, UpsertOAuthUserInput } from "../../db.js";

const EDIT_PASSWORD = "edit-secret";
const ADMIN_PASSWORD = "admin-secret";

test("creating a session purges expired session rows", () => {
  const db = initDb(":memory:");
  const user = db.upsertOAuthUser({ provider: "github", providerUserId: "expired-session-user" });
  db.createSession(user.id, "reusable-session-hash", "2000-01-01T00:00:00.000Z");

  assert.doesNotThrow(() => {
    db.createSession(user.id, "reusable-session-hash", "2100-01-01T00:00:00.000Z");
  });
  assert.equal(db.getUserBySessionHash("reusable-session-hash", "2099-01-01T00:00:00.000Z")?.id, user.id);
});

test("editor sessions store only hashes, enforce expiry, and can be revoked", () => {
  const db = initDb(":memory:");
  const sessionHash = hashSessionToken("opaque-editor-session");
  db.createEditorSession("admin", sessionHash, "2099-01-01T00:00:00.000Z");

  assert.equal(
    db.getEditorSessionByHash(sessionHash, "2098-01-01T00:00:00.000Z")?.role,
    "admin",
  );
  assert.equal(db.getEditorSessionByHash("opaque-editor-session"), null);
  assert.equal(db.deleteEditorSessionByHash(sessionHash), true);
  assert.equal(db.getEditorSessionByHash(sessionHash), null);

  db.createEditorSession("editor", sessionHash, "2000-01-01T00:00:00.000Z");
  assert.equal(db.getEditorSessionByHash(sessionHash), null);
  assert.doesNotThrow(() => {
    db.createEditorSession("editor", sessionHash, "2099-01-01T00:00:00.000Z");
  });
});

test("expired OAuth states cannot be consumed", () => {
  const db = initDb(":memory:");
  db.createOAuthState(hashSessionToken("expired-oauth-state"), "2026-01-01T00:00:00.000Z");

  assert.equal(
    db.consumeOAuthState(hashSessionToken("expired-oauth-state"), "2026-01-01T00:00:00.001Z"),
    false,
  );
});

test("OAuth user updates preserve an existing email when the provider lookup is inconclusive", () => {
  const db = initDb(":memory:");
  const original = db.upsertOAuthUser({
    provider: "github",
    providerUserId: "email-preserve-user",
    email: "kept@example.com",
  });
  const updated = db.upsertOAuthUser({
    provider: "github",
    providerUserId: "email-preserve-user",
    email: undefined,
    displayName: "Updated Name",
  });

  assert.equal(updated.id, original.id);
  assert.equal(updated.email, "kept@example.com");
});

function createAuthStore(aiAccessStatus: AIAccessGrantRow["status"] | null): AuthStore {
  const user: AuthenticatedUser = {
    id: "usr_1",
    provider: "github",
    providerUserId: "42",
    email: "sub@example.com",
    displayName: "OSS Contributor",
    avatarUrl: null,
  };
  const aiAccessGrants = new Map<string, AIAccessGrantRow>();
  const oauthStates = new Map<string, string>();
  const sessionHashes = new Set<string>([hashSessionToken("session-token")]);
  if (aiAccessStatus) {
    aiAccessGrants.set(user.id, {
      id: "grant_1",
      userId: user.id,
      provider: "test",
      providerGrantId: "provider-grant-1",
      status: aiAccessStatus,
      label: "default",
      expiresAt: "2099-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  }

  return {
    upsertOAuthUser(_input: UpsertOAuthUserInput): AuthenticatedUser {
      return user;
    },
    createOAuthState(stateHash: string, expiresAt: string): void {
      oauthStates.set(stateHash, expiresAt);
    },
    consumeOAuthState(stateHash: string, nowIso: string): boolean {
      const expiresAt = oauthStates.get(stateHash);
      const consumed = expiresAt !== undefined && expiresAt > nowIso;
      if (consumed) oauthStates.delete(stateHash);
      for (const [hash, expiry] of oauthStates) {
        if (expiry <= nowIso) oauthStates.delete(hash);
      }
      return consumed;
    },
    createSession(_userId: string, sessionHash: string, _expiresAt: string) {
      sessionHashes.add(sessionHash);
      return { id: "sess_1", userId: user.id, expiresAt: _expiresAt };
    },
    getUserBySessionHash(sessionHash: string): AuthenticatedUser | null {
      return sessionHashes.has(sessionHash) ? user : null;
    },
    deleteSessionByHash(_sessionHash: string): boolean {
      return true;
    },
    getAIAccessGrantForUser(userId: string): AIAccessGrantRow | null {
      return aiAccessGrants.get(userId) ?? null;
    },
    setAIAccessGrant(row: Omit<AIAccessGrantRow, "id" | "updatedAt">): AIAccessGrantRow {
      const next = { ...row, id: "grant_1", updatedAt: "2026-01-01T00:00:00.000Z" };
      aiAccessGrants.set(row.userId, next);
      return next;
    },
  };
}

function extractOAuthFlow(
  location: unknown,
  setCookie: unknown,
  secureCookie = false,
): { state: string; cookie: string } {
  const state = new URL(String(location)).searchParams.get("state");
  assert.ok(state, "OAuth redirect state was not set");
  const cookieName = secureCookie ? "__Host-erd-flow" : "erd-flow";
  const match = new RegExp(`${cookieName}=([^;]+)`).exec(String(setCookie));
  const encodedHash = match?.[1];
  assert.ok(encodedHash, "OAuth flow cookie was not set");
  const stateHash = decodeURIComponent(encodedHash);
  assert.equal(stateHash, hashSessionToken(state));
  assert.notEqual(stateHash, state);
  return {
    state,
    cookie: `${cookieName}=${encodedHash}`,
  };
}

async function buildApp(
  aiAccessStatus: AIAccessGrantRow["status"] | null,
  aiProvider: "litellm" | "codex" = "litellm",
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const authStore = createAuthStore(aiAccessStatus);
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, { authStore });
  registerAIRoutes(app, {
    aiProvider,
    codexComplete: async () => '{"summary":"should not run","suggestions":[]}',
    litellmBaseUrl: "http://litellm.test",
  });
  await app.ready();
  return app;
}

function injectChat(app: FastifyInstance, cookie = "erd-session=session-token") {
  return app.inject({
    method: "POST",
    url: "/ai/chat/completions",
    headers: {
      cookie,
      host: "localhost:3001",
      origin: "http://localhost:3001",
      "content-type": "application/json",
    },
    payload: { messages: [{ role: "user", content: "hi" }] },
  });
}

test("enabled OAuth AI access grant can use the AI proxy without admin password", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"choices":[]}', { status: 200 })) as typeof fetch;
  const app = await buildApp("enabled");
  try {
    const res = await injectChat(app);
    assert.equal(res.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("Codex subscription provider is restricted to the local admin token", async () => {
  const app = await buildApp("enabled", "codex");
  try {
    const res = await injectChat(app);
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /local admin/i);
  } finally {
    await app.close();
  }
});

test("logged-in OAuth user without an enabled AI access grant gets 402", async () => {
  const app = await buildApp("disabled");
  try {
    const res = await injectChat(app);
    assert.equal(res.statusCode, 402);
    assert.match(res.body, /AI access/i);
  } finally {
    await app.close();
  }
});

test("cookie-auth AI proxy rejects cross-origin POST requests", async () => {
  const app = await buildApp("enabled");
  try {
    const res = await app.inject({
      method: "POST",
      url: "/ai/chat/completions",
      headers: {
        cookie: "erd-session=session-token",
        origin: "https://evil.example",
        "content-type": "application/json",
      },
      payload: { messages: [{ role: "user", content: "hi" }] },
    });
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /same-origin/i);
  } finally {
    await app.close();
  }
});

test("tokenless cross-origin logout is rejected without clearing the cookie", async () => {
  const app = await buildApp("enabled");
  try {
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { host: "localhost:3001", origin: "https://evil.example" },
    });
    assert.equal(res.statusCode, 403);
    assert.equal(res.headers["set-cookie"], undefined);
  } finally {
    await app.close();
  }
});

test("same-origin logout still clears the session cookie", async () => {
  const app = await buildApp("enabled");
  try {
    const res = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: {
        host: "localhost:3001",
        origin: "http://localhost:3001",
        cookie: "erd-session=session-token",
      },
    });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers["set-cookie"]), /erd-session=/);
  } finally {
    await app.close();
  }
});

test("/auth/me exposes OAuth user AI access grant", async () => {
  const app = await buildApp("enabled");
  try {
    const res = await app.inject({ method: "GET", url: "/auth/me", headers: { cookie: "erd-session=session-token" } });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { user: { email: string } | null; aiAccessGrant: { status: string } | null; canUseAI: boolean };
    assert.equal(body.user?.email, "sub@example.com");
    assert.equal(body.aiAccessGrant?.status, "enabled");
    assert.equal(body.canUseAI, true);
  } finally {
    await app.close();
  }
});

test("GitHub OAuth callback rejects a matching state that was not issued by the server", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response("unexpected upstream call", { status: 500 });
  }) as typeof fetch;

  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
  });
  await app.ready();

  try {
    const res = await app.inject({
      method: "GET",
      url: "/auth/oauth/github/callback?code=abc&state=attacker-state",
      headers: { cookie: `erd-flow=${hashSessionToken("attacker-state")}` },
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(JSON.parse(res.body), { ok: false, error: "invalid OAuth state" });
    assert.equal(callCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub OAuth callback creates a session and rejects reuse of the issued state", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    callCount += 1;
    const textUrl = String(url);
    if (textUrl.includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "gh-token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (textUrl.endsWith("/user")) {
      return new Response(JSON.stringify({ id: 42, login: "sub", name: "OSS Contributor", email: "sub@example.com" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
  });
  await app.ready();

  try {
    const start = await app.inject({ method: "GET", url: "/auth/oauth/github/start" });
    assert.equal(start.statusCode, 302);
    const { state, cookie } = extractOAuthFlow(start.headers.location, start.headers["set-cookie"]);
    const res = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 302);
    assert.match(String(res.headers["set-cookie"]), /erd-session=/);
    assert.equal(callCount, 2);

    const replay = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=replay&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    assert.equal(replay.statusCode, 400);
    assert.deepEqual(JSON.parse(replay.body), { ok: false, error: "invalid OAuth state" });
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub OAuth callback clears state cookie when token exchange fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("upstream failure", { status: 500 })) as typeof fetch;

  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
  });
  await app.ready();

  try {
    const start = await app.inject({ method: "GET", url: "/auth/oauth/github/start" });
    assert.equal(start.statusCode, 302);
    const { state, cookie } = extractOAuthFlow(start.headers.location, start.headers["set-cookie"]);
    const res = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 502);
    assert.match(String(res.headers["set-cookie"]), /erd-flow=;/);
    assert.match(String(res.headers["set-cookie"]), /Max-Age=0/);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("GitHub OAuth callback aborts stalled upstream requests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response(JSON.stringify({ access_token: "late-token" }), { status: 200 }));
    }, 30);
    init?.signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(init.signal?.reason ?? new Error("aborted"));
    }, { once: true });
  })) as typeof fetch;

  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
    oauthTimeoutMs: 5,
  });
  await app.ready();

  try {
    const start = await app.inject({ method: "GET", url: "/auth/oauth/github/start" });
    assert.equal(start.statusCode, 302);
    const { state, cookie } = extractOAuthFlow(start.headers.location, start.headers["set-cookie"]);
    const res = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    assert.equal(res.statusCode, 504);
    assert.match(res.body, /timeout/i);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("secureCookie uses __Host- prefixed cookies for the whole session lifecycle", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const textUrl = String(url);
    if (textUrl.includes("access_token")) {
      return new Response(JSON.stringify({ access_token: "gh-token" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (textUrl.endsWith("/user")) {
      return new Response(JSON.stringify({ id: 42, login: "sub", name: "OSS Contributor", email: "sub@example.com" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;

  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore, secureCookie: true });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
    secureCookie: true,
  });
  await app.ready();

  try {
    const start = await app.inject({ method: "GET", url: "/auth/oauth/github/start" });
    assert.equal(start.statusCode, 302);
    const startCookie = String(start.headers["set-cookie"]);
    const { state, cookie } = extractOAuthFlow(start.headers.location, startCookie, true);
    assert.match(startCookie, /Secure/);
    assert.match(startCookie, /Path=\//);
    assert.doesNotMatch(startCookie, /Domain=/i);

    const cb = await app.inject({
      method: "GET",
      url: `/auth/oauth/github/callback?code=abc&state=${encodeURIComponent(state)}`,
      headers: { cookie },
    });
    assert.equal(cb.statusCode, 302);
    const cbCookies = String(cb.headers["set-cookie"]);
    const sessionValue = /__Host-erd-session=([^;]+)/.exec(cbCookies)?.[1];
    assert.ok(sessionValue, "session cookie must use the __Host- prefix");
    assert.match(cbCookies, /__Host-erd-flow=;/);
    assert.doesNotMatch(cbCookies, /(^|[^-])erd-session=/);

    const me = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { cookie: `__Host-erd-session=${sessionValue}` },
    });
    assert.equal(me.statusCode, 200);
    assert.equal(JSON.parse(me.body).canUseAI, true);

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { cookie: `__Host-erd-session=${sessionValue}`, origin: "https://erd.example.com" },
    });
    assert.equal(logout.statusCode, 200);
    const logoutCookie = String(logout.headers["set-cookie"]);
    assert.match(logoutCookie, /__Host-erd-session=;/);
    assert.match(logoutCookie, /Max-Age=0/);
    assert.match(logoutCookie, /Secure/);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("without secureCookie the cookie names stay unprefixed", async () => {
  const app = Fastify({ logger: false });
  const authStore = createAuthStore("enabled");
  registerAuth(app, { editPassword: EDIT_PASSWORD, adminPassword: ADMIN_PASSWORD, authStore });
  registerOAuthRoutes(app, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    appBaseUrl: "https://erd.example.com",
  });
  await app.ready();

  try {
    const start = await app.inject({ method: "GET", url: "/auth/oauth/github/start" });
    const startCookie = String(start.headers["set-cookie"]);
    assert.match(startCookie, /^erd-flow=/);
    assert.doesNotMatch(startCookie, /__Host-/);
  } finally {
    await app.close();
  }
});

test("GitHub OAuth start and callback are rate-limited per app instance", async () => {
  const authStore = createAuthStore("enabled");
  const startApp = Fastify({ logger: false });
  registerOAuthRoutes(startApp, {
    authStore,
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    oauthRateLimitPoints: 1,
    oauthRateLimitDurationSeconds: 60,
  });
  await startApp.ready();

  const callbackApp = Fastify({ logger: false });
  registerOAuthRoutes(callbackApp, {
    authStore: createAuthStore("enabled"),
    githubClientId: "client-id",
    githubClientSecret: "client-secret",
    oauthRateLimitPoints: 1,
    oauthRateLimitDurationSeconds: 60,
  });
  await callbackApp.ready();

  try {
    assert.equal((await startApp.inject({ method: "GET", url: "/auth/oauth/github/start" })).statusCode, 302);
    const blockedStart = await startApp.inject({ method: "GET", url: "/auth/oauth/github/start" });
    assert.equal(blockedStart.statusCode, 429);
    assert.ok(Number(blockedStart.headers["retry-after"]) > 0);

    const invalidCallback = {
      method: "GET" as const,
      url: "/auth/oauth/github/callback?code=abc&state=attacker-state",
      headers: { cookie: `erd-flow=${hashSessionToken("attacker-state")}` },
    };
    assert.equal((await callbackApp.inject(invalidCallback)).statusCode, 400);
    const blockedCallback = await callbackApp.inject(invalidCallback);
    assert.equal(blockedCallback.statusCode, 429);
    assert.ok(Number(blockedCallback.headers["retry-after"]) > 0);
  } finally {
    await startApp.close();
    await callbackApp.close();
  }
});
