import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createLoginRateLimiter, ensureEditor, registerAuth } from "../auth.js";

const SAME_ORIGIN_HEADERS = {
  host: "localhost:3001",
  origin: "http://localhost:3001",
};

test("만료된 다른 IP의 엔트리는 다음 check 호출에서 정리된다 (메모리 누적 방지)", () => {
  let now = 1_000;
  const limiter = createLoginRateLimiter({ windowMs: 100, maxAttempts: 3, now: () => now });

  limiter.check("ip-1");
  assert.equal(limiter.size(), 1);

  now += 101; // ip-1 윈도우 만료, ip-1은 다시 오지 않음
  limiter.check("ip-2");
  assert.equal(limiter.size(), 1, "만료된 ip-1 엔트리가 회수되지 않고 누적됨");
});

test("전역 sweep 게이트와 무관하게 자기 엔트리의 윈도우 만료는 즉시 반영된다 (lazy 만료)", () => {
  // 게이트 주기와 엔트리 만료가 어긋나는 시나리오:
  // t=0 에 게이트가 갱신되고(t=100 예정), t=50 에 만든 엔트리는 t=150 만료 —
  // t=160 시점엔 게이트(t=220)가 아직 멀었어도 만료된 자기 엔트리는 무시돼야 한다.
  let now = 0;
  const limiter = createLoginRateLimiter({ windowMs: 100, maxAttempts: 2, now: () => now });

  limiter.check("ip-a"); // t=0: 게이트 소비 → 다음 sweep 은 t>=100

  now = 50;
  assert.equal(limiter.check("ip-b"), true);
  assert.equal(limiter.check("ip-b"), true);
  assert.equal(limiter.check("ip-b"), false, "maxAttempts 도달 — 차단");

  now = 120; // 게이트 발화(>=100) → sweep, ip-b(만료 t=150 전)는 생존, 게이트 t=220 으로
  limiter.check("ip-a");

  now = 160; // ip-b 만료(150) 지남, 그러나 게이트(220)는 아직
  assert.equal(limiter.check("ip-b"), true, "sweep 이 안 돌아도 만료된 자기 엔트리는 리셋되어야 함");
});

test("rate limit 동작 보존: maxAttempts 초과 차단, 윈도우 경과 후 재허용", () => {
  let now = 1_000;
  const limiter = createLoginRateLimiter({ windowMs: 100, maxAttempts: 3, now: () => now });

  assert.equal(limiter.check("ip-1"), true);
  assert.equal(limiter.check("ip-1"), true);
  assert.equal(limiter.check("ip-1"), true);
  assert.equal(limiter.check("ip-1"), false, "4번째 시도는 차단되어야 함");

  now += 101; // 윈도우 만료
  assert.equal(limiter.check("ip-1"), true, "윈도우 경과 후에는 다시 허용");
});

test("successful logins do not consume the failed-login rate limit", async () => {
  const app = Fastify();
  registerAuth(app, { editPassword: "edit", adminPassword: "admin" });
  await app.ready();
  try {
    for (let i = 0; i < 12; i += 1) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: SAME_ORIGIN_HEADERS,
        payload: { password: "edit" },
      });
      assert.equal(res.statusCode, 200);
    }
  } finally {
    await app.close();
  }
});

test("successful editor login does not clear failed admin attempts", async () => {
  const app = Fastify();
  registerAuth(app, { editPassword: "edit", adminPassword: "admin" });
  await app.ready();
  try {
    const remoteAddress = "198.51.100.10";
    for (let i = 0; i < 9; i += 1) {
      const bad = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: SAME_ORIGIN_HEADERS,
        payload: { password: `admin-guess-${i}` },
        remoteAddress,
      });
      assert.equal(bad.statusCode, 401);
    }

    const editor = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: SAME_ORIGIN_HEADERS,
      payload: { password: "edit" },
      remoteAddress,
    });
    assert.equal(editor.statusCode, 200);
    assert.deepEqual(JSON.parse(editor.body), { ok: true, role: "editor" });

    const finalAllowedGuess = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: SAME_ORIGIN_HEADERS,
      payload: { password: "admin-guess-final" },
      remoteAddress,
    });
    assert.equal(finalAllowedGuess.statusCode, 401);

    const locked = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: SAME_ORIGIN_HEADERS,
      payload: { password: "admin-guess-locked" },
      remoteAddress,
    });
    assert.equal(locked.statusCode, 429);
  } finally {
    await app.close();
  }
});

test("rate-limited IP cannot bypass lockout with the correct password", async () => {
  const app = Fastify();
  registerAuth(app, { editPassword: "edit", adminPassword: "admin" });
  await app.ready();
  try {
    for (let i = 0; i < 10; i += 1) {
      const bad = await app.inject({
        method: "POST",
        url: "/auth/login",
        headers: SAME_ORIGIN_HEADERS,
        payload: { password: "wrong" },
      });
      assert.equal(bad.statusCode, 401);
    }
    const locked = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: SAME_ORIGIN_HEADERS,
      payload: { password: "wrong" },
    });
    assert.equal(locked.statusCode, 429);

    const good = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: SAME_ORIGIN_HEADERS,
      payload: { password: "edit" },
    });
    assert.equal(good.statusCode, 429);
  } finally {
    await app.close();
  }
});

test("password login returns no reusable secret and only the opaque session cookie authorizes editing", async () => {
  const app = Fastify();
  registerAuth(app, { editPassword: "edit", adminPassword: "admin" });
  app.get("/protected", async (req, reply) => {
    if (!ensureEditor(req, reply)) return;
    return { ok: true };
  });
  await app.ready();
  try {
    const login = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { host: "localhost:3001", origin: "http://localhost:3001" },
      payload: { password: "edit" },
    });
    assert.equal(login.statusCode, 200);
    assert.deepEqual(login.json(), { ok: true, role: "editor" });
    const setCookie = String(login.headers["set-cookie"]);
    assert.match(setCookie, /^erd-editor-session=/);
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    const sessionValue = /^erd-editor-session=([^;]+)/.exec(setCookie)?.[1];
    assert.ok(sessionValue);
    assert.notEqual(sessionValue, "edit");

    const cookie = setCookie.split(";")[0];
    const authorized = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie },
    });
    assert.equal(authorized.statusCode, 200);

    const replayedPassword = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer edit" },
    });
    assert.equal(replayedPassword.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("cross-origin password login is rejected before a session is created", async () => {
  const app = Fastify();
  registerAuth(app, { editPassword: "edit", adminPassword: "admin" });
  await app.ready();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      headers: { host: "localhost:3001", origin: "https://attacker.example" },
      payload: { password: "edit" },
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.headers["set-cookie"], undefined);
  } finally {
    await app.close();
  }
});
