import "dotenv/config";
import Fastify from "fastify";
import { initDb } from "./db.js";
import { registerAuth } from "./auth.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAIRoutes } from "./routes/ai.js";
import { registerOAuthRoutes } from "./routes/oauth.js";
import { assertCodexLocalHost, createCodexCompletion, parseAIProvider } from "./codex-provider.js";
import { serializeRequestForLog } from "./logging.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";
const DB_PATH = process.env.DB_PATH ?? "./erd.db";
const EDIT_PASSWORD = process.env.EDIT_PASSWORD ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || undefined;
const AI_PROVIDER = parseAIProvider(process.env.AI_PROVIDER);
const CODEX_MODEL = process.env.CODEX_MODEL || undefined;
const LITELLM_BASE_URL = process.env.LITELLM_BASE_URL;
const LITELLM_API_KEY = process.env.LITELLM_API_KEY;
const LITELLM_MODEL = process.env.LITELLM_MODEL || undefined;
const GITHUB_OAUTH_CLIENT_ID = process.env.GITHUB_OAUTH_CLIENT_ID;
const GITHUB_OAUTH_CLIENT_SECRET = process.env.GITHUB_OAUTH_CLIENT_SECRET;
const APP_BASE_URL = process.env.APP_BASE_URL;
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1" || process.env.COOKIE_SECURE === "true";
const PROJECT_READ_ACCESS = process.env.PROJECT_READ_ACCESS === "public" ? "public" : "private";
const EDITOR_SESSION_TTL_HOURS = Number(process.env.EDITOR_SESSION_TTL_HOURS ?? 8);
const EDITOR_SESSION_TTL_MS = EDITOR_SESSION_TTL_HOURS * 60 * 60 * 1000;

assertCodexLocalHost(AI_PROVIDER, HOST);

if (!EDIT_PASSWORD) {
  console.error("EDIT_PASSWORD env var is required");
  process.exit(1);
}

if (!Number.isFinite(EDITOR_SESSION_TTL_HOURS) || EDITOR_SESSION_TTL_HOURS <= 0 || EDITOR_SESSION_TTL_HOURS > 168) {
  console.error("EDITOR_SESSION_TTL_HOURS must be a number between 0 and 168");
  process.exit(1);
}

if (ADMIN_PASSWORD && ADMIN_PASSWORD === EDIT_PASSWORD) {
  console.error("ADMIN_PASSWORD must differ from EDIT_PASSWORD (separating editor vs admin grants no value otherwise)");
  process.exit(1);
}

if (AI_PROVIDER === "codex" && !ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD is required when AI_PROVIDER=codex");
  process.exit(1);
}

if (!ADMIN_PASSWORD) {
  console.warn("ADMIN_PASSWORD not set — AI inference requires an enabled OAuth AI access grant.");
}

if (process.env.NODE_ENV === "production") {
  if (!APP_BASE_URL || !APP_BASE_URL.startsWith("https://")) {
    console.error("APP_BASE_URL with https:// is required in production");
    process.exit(1);
  }
  if (!COOKIE_SECURE) {
    console.error("COOKIE_SECURE=true is required in production");
    process.exit(1);
  }
  if ((GITHUB_OAUTH_CLIENT_ID || GITHUB_OAUTH_CLIENT_SECRET) && (!GITHUB_OAUTH_CLIENT_ID || !GITHUB_OAUTH_CLIENT_SECRET)) {
    console.error("Both GITHUB_OAUTH_CLIENT_ID and GITHUB_OAUTH_CLIENT_SECRET are required when OAuth is enabled");
    process.exit(1);
  }
}

const db = initDb(DB_PATH);
const aiShutdownController = new AbortController();
const codexComplete = AI_PROVIDER === "codex"
  ? createCodexCompletion({ model: CODEX_MODEL })
  : undefined;

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    serializers: { req: serializeRequestForLog },
  },
  bodyLimit: 8 * 1024 * 1024,
  // nginx 가 loopback 으로 forward 하므로 loopback 발 X-Forwarded-For 만 신뢰한다.
  // 그래야 auth.ts 의 rate limiter 가 실제 client IP 로 카운트한다.
  trustProxy: "loopback",
});

app.get("/healthz", async () => ({ ok: true }));

await app.register(
  async (instance) => {
    registerAuth(instance, {
      editPassword: EDIT_PASSWORD,
      adminPassword: ADMIN_PASSWORD,
      authStore: db,
      editorSessionStore: db,
      editorSessionTtlMs: EDITOR_SESSION_TTL_MS,
      secureCookie: COOKIE_SECURE,
      appBaseUrl: APP_BASE_URL,
    });
    registerOAuthRoutes(instance, {
      authStore: db,
      githubClientId: GITHUB_OAUTH_CLIENT_ID,
      githubClientSecret: GITHUB_OAUTH_CLIENT_SECRET,
      appBaseUrl: APP_BASE_URL,
      secureCookie: COOKIE_SECURE,
      editorSessionStore: db,
    });
    registerProjectRoutes(instance, {
      db,
      readAccess: PROJECT_READ_ACCESS,
      appBaseUrl: APP_BASE_URL,
    });
    registerAIRoutes(instance, {
      aiProvider: AI_PROVIDER,
      codexComplete,
      litellmBaseUrl: LITELLM_BASE_URL,
      litellmApiKey: LITELLM_API_KEY,
      litellmModel: LITELLM_MODEL,
      appBaseUrl: APP_BASE_URL,
      shutdownSignal: aiShutdownController.signal,
    });
  },
  { prefix: "/api" },
);

// systemd(SIGTERM)/로컬 Ctrl+C(SIGINT) 시 in-flight 요청을 마무리하고 종료한다.
// AI passthrough 가 최대 110s 점유 가능하므로, hung 요청이 종료를 systemd grace 너머로
// 끌지 않도록 강제 종료 타이머와 race 한다.
const SHUTDOWN_GRACE_MS = 10_000;
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, "shutting down gracefully");
    aiShutdownController.abort();
    setTimeout(() => {
      app.log.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_GRACE_MS).unref();
    app.close().then(
      () => process.exit(0),
      (err) => {
        app.log.error(err);
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ port: PORT, host: HOST });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
