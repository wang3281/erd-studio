import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import Fastify, { type FastifyInstance } from "fastify";
import { hashSessionToken, registerAuth } from "../../auth.js";
import type { EditorSessionStore } from "../../db.js";
import { registerAIRoutes } from "../ai.js";

const EDIT_PASSWORD = "edit-secret";
const ADMIN_PASSWORD = "admin-secret";
const EDITOR_SESSION_TOKEN = "test-editor-session";
const ADMIN_SESSION_TOKEN = "test-admin-session";
const sessionRoles = new Map([
  [hashSessionToken(EDITOR_SESSION_TOKEN), "editor" as const],
  [hashSessionToken(ADMIN_SESSION_TOKEN), "admin" as const],
]);
const editorSessionStore: EditorSessionStore = {
  createEditorSession(role, _sessionHash, expiresAt) {
    return { id: "test-session", role, expiresAt };
  },
  getEditorSessionByHash(sessionHash) {
    const role = sessionRoles.get(sessionHash);
    return role
      ? { id: "test-session", role, expiresAt: "2099-01-01T00:00:00.000Z" }
      : null;
  },
  deleteEditorSessionByHash() {
    return true;
  },
};

interface BuildOptions {
  aiProvider?: "litellm" | "codex";
  codexComplete?: (body: Record<string, unknown>, signal: AbortSignal) => Promise<string>;
  shutdownSignal?: AbortSignal;
  upstreamTimeoutMs?: number;
  onReply?: (raw: ServerResponse) => void;
  onSend?: (statusCode: number) => void;
}

async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerAuth(app, {
    editPassword: EDIT_PASSWORD,
    adminPassword: ADMIN_PASSWORD,
    editorSessionStore,
  });
  registerAIRoutes(app, {
    aiProvider: opts.aiProvider,
    codexComplete: opts.codexComplete,
    litellmBaseUrl: "http://litellm.test",
    litellmApiKey: "test-api-key",
    shutdownSignal: opts.shutdownSignal,
    upstreamTimeoutMs: opts.upstreamTimeoutMs,
  });
  app.addHook("preHandler", (_req, reply, done) => {
    opts.onReply?.(reply.raw);
    done();
  });
  app.addHook("onSend", (_req, reply, payload, done) => {
    opts.onSend?.(reply.statusCode);
    done(null, payload);
  });
  await app.ready();
  return app;
}

function injectChat(app: FastifyInstance, token: string, remoteAddress?: string) {
  const sessionToken = token === ADMIN_PASSWORD ? ADMIN_SESSION_TOKEN : EDITOR_SESSION_TOKEN;
  return app.inject({
    method: "POST",
    url: "/ai/chat/completions",
    headers: {
      cookie: `erd-editor-session=${sessionToken}`,
      host: "localhost:3001",
      origin: "http://localhost:3001",
      "content-type": "application/json",
    },
    payload: { messages: [{ role: "user", content: "hi" }] },
    remoteAddress,
  });
}

test("upstream fetch에 AbortSignal을 전달한다", async () => {
  const originalFetch = globalThis.fetch;
  let capturedSignal: AbortSignal | null | undefined;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    capturedSignal = init?.signal;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 200);
    assert.ok(capturedSignal instanceof AbortSignal, "fetch가 AbortSignal 없이 호출됨 — 무기한 대기 가능");
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("upstream이 timeout 내 응답하지 않으면 504를 반환한다", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      // 수정 후: 라우트의 timeout abort가 이 리스너로 전파되어 즉시 reject
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
      // 수정 전(시그널 부재) 안전망: 테스트가 무한 대기하지 않도록 일반 오류로 reject
      setTimeout(() => reject(new Error("stub-safety-timeout")), 500);
    })) as typeof fetch;

  const app = await buildApp({ upstreamTimeoutMs: 30 });
  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 504);
    assert.match(res.body, /timeout/i);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("정상 응답은 상태/본문/content-type을 그대로 전달한다 (회귀)", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{"choices":[]}', {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

  const app = await buildApp();
  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 200);
    // undici Response가 charset을 덧붙여 정규화하므로 미디어 타입만 검증
    assert.match(String(res.headers["content-type"]), /^application\/json/);
    assert.equal(res.body, '{"choices":[]}');
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("Codex provider wraps its final response in the existing chat-completions contract", async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("unexpected");
  }) as typeof fetch;
  let capturedBody: Record<string, unknown> | undefined;
  let capturedSignal: AbortSignal | undefined;
  const app = await buildApp({
    aiProvider: "codex",
    codexComplete: async (body, signal) => {
      capturedBody = body;
      capturedSignal = signal;
      return '{"summary":"subscription result","suggestions":[]}';
    },
  });

  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 200);
    assert.equal(fetchCalled, false);
    assert.deepEqual(capturedBody?.messages, [{ role: "user", content: "hi" }]);
    assert.ok(capturedSignal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(res.body), {
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: '{"summary":"subscription result","suggestions":[]}',
            role: "assistant",
          },
        },
      ],
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test("Codex provider returns 503 when its local runner is unavailable", async () => {
  const app = await buildApp({ aiProvider: "codex" });
  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /Codex/i);
  } finally {
    await app.close();
  }
});

test("Codex provider rejects admin-token requests from non-loopback clients", async () => {
  const app = await buildApp({
    aiProvider: "codex",
    codexComplete: async () => '{"summary":"must not run","suggestions":[]}',
  });
  try {
    const res = await injectChat(app, ADMIN_PASSWORD, "203.0.113.10");
    assert.equal(res.statusCode, 403);
    assert.match(res.body, /loopback/i);

    const malformed = await injectChat(app, ADMIN_PASSWORD, "127.invalid");
    assert.equal(malformed.statusCode, 403);
    assert.match(malformed.body, /loopback/i);
  } finally {
    await app.close();
  }
});

test("Codex provider maps an aborted turn to the existing 504 timeout contract", async () => {
  const app = await buildApp({
    aiProvider: "codex",
    upstreamTimeoutMs: 30,
    codexComplete: (_body, signal) =>
      new Promise<string>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
  });
  try {
    const res = await injectChat(app, ADMIN_PASSWORD);
    assert.equal(res.statusCode, 504);
    assert.match(res.body, /timeout/i);
  } finally {
    await app.close();
  }
});

test("client disconnect remains the abort cause after the timeout deadline", {
  timeout: 2_000,
}, async () => {
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let markAborted!: () => void;
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve;
  });
  const sentStatuses: number[] = [];
  let rawReply: ServerResponse | undefined;
  const app = await buildApp({
    aiProvider: "codex",
    upstreamTimeoutMs: 30,
    onReply: (raw) => {
      rawReply = raw;
    },
    onSend: (statusCode) => sentStatuses.push(statusCode),
    codexComplete: (_body, signal) =>
      new Promise<string>((_resolve, reject) => {
        markStarted();
        signal.addEventListener("abort", () => {
          markAborted();
          setTimeout(
            () => reject(new DOMException("aborted", "AbortError")),
            60,
          );
        }, { once: true });
      }),
  });

  try {
    void injectChat(app, ADMIN_PASSWORD).catch(() => {});
    await started;
    assert.ok(rawReply);
    rawReply.emit("close");
    await aborted;
    await new Promise((resolve) => setTimeout(resolve, 100));

    assert.equal(sentStatuses.includes(504), false);
  } finally {
    await app.close();
  }
});

test("server shutdown aborts an in-flight Codex request", async () => {
  const shutdown = new AbortController();
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const app = await buildApp({
    aiProvider: "codex",
    shutdownSignal: shutdown.signal,
    codexComplete: (_body, signal) =>
      new Promise<string>((_resolve, reject) => {
        markStarted();
        const safetyTimer = setTimeout(
          () => reject(new Error("shutdown signal was not propagated")),
          500,
        );
        signal.addEventListener("abort", () => {
          clearTimeout(safetyTimer);
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  });
  try {
    const response = injectChat(app, ADMIN_PASSWORD);
    await started;
    shutdown.abort();
    const res = await response;
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /shutting down/i);
  } finally {
    await app.close();
  }
});

test("editor 토큰은 403, 무토큰은 401 (회귀: admin 게이트)", async () => {
  const app = await buildApp();
  try {
    const asEditor = await injectChat(app, EDIT_PASSWORD);
    assert.equal(asEditor.statusCode, 403);

    const anonymous = await app.inject({
      method: "POST",
      url: "/ai/chat/completions",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    assert.equal(anonymous.statusCode, 401);
  } finally {
    await app.close();
  }
});
