import type { FastifyInstance, FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AuthStore, EditorSessionStore, UpsertOAuthUserInput } from "../db.js";
import {
  DEFAULT_EDITOR_SESSION_COOKIE_NAME,
  DEFAULT_SESSION_COOKIE_NAME,
  cookieNameFor,
  createSessionToken,
  ensureSameOriginRequest,
  hashSessionToken,
  hasAIAccess,
  isActiveAIAccessGrant,
  parseCookieHeader,
  serializeCookie,
} from "../auth.js";

interface OAuthRouteOptions {
  authStore: AuthStore;
  githubClientId?: string;
  githubClientSecret?: string;
  appBaseUrl?: string;
  sessionCookieName?: string;
  editorSessionCookieName?: string;
  editorSessionStore?: EditorSessionStore;
  sessionTtlMs?: number;
  secureCookie?: boolean;
  oauthTimeoutMs?: number;
  oauthRateLimitPoints?: number;
  oauthRateLimitDurationSeconds?: number;
}

interface GitHubTokenResponse {
  access_token?: unknown;
  error?: unknown;
}

interface GitHubUserResponse {
  id?: unknown;
  login?: unknown;
  name?: unknown;
  email?: unknown;
  avatar_url?: unknown;
}

interface GitHubEmailResponse {
  email?: unknown;
  primary?: unknown;
  verified?: unknown;
}

const FLOW_COOKIE_BASENAME = "erd-flow";
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_OAUTH_TIMEOUT_MS = 15_000;
const DEFAULT_OAUTH_RATE_LIMIT_POINTS = 30;
const DEFAULT_OAUTH_RATE_LIMIT_DURATION_SECONDS = 60;

function absoluteUrl(req: FastifyRequest, path: string, appBaseUrl?: string): string {
  if (appBaseUrl) return `${appBaseUrl.replace(/\/+$/, "")}${path}`;
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "127.0.0.1";
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}${path}`;
}

function clearCookie(
  name: string,
  secureCookie?: boolean,
  sameSite: "Lax" | "Strict" = "Lax",
): string {
  return serializeCookie(name, "", { maxAge: 0, httpOnly: true, sameSite, secure: secureCookie });
}

function getSessionToken(req: FastifyRequest, cookieName: string): string | undefined {
  const cookieHeader = Array.isArray(req.headers.cookie) ? req.headers.cookie.join("; ") : req.headers.cookie;
  return parseCookieHeader(cookieHeader).get(cookieName);
}

function aiAccessGrantBody(req: FastifyRequest) {
  return req.currentAIAccessGrant
    ? {
        status: req.currentAIAccessGrant.status,
        label: req.currentAIAccessGrant.label,
        expiresAt: req.currentAIAccessGrant.expiresAt,
      }
    : null;
}

function userBody(req: FastifyRequest) {
  return req.currentUser
    ? {
        id: req.currentUser.id,
        email: req.currentUser.email,
        displayName: req.currentUser.displayName,
        avatarUrl: req.currentUser.avatarUrl,
      }
    : null;
}

async function fetchGitHubUser(accessToken: string, signal: AbortSignal): Promise<UpsertOAuthUserInput> {
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${accessToken}`,
      "user-agent": "erd-studio-oauth",
    },
    signal,
  });
  if (!userRes.ok) throw new Error("GitHub userinfo failed");
  const user = (await userRes.json()) as GitHubUserResponse;
  if (typeof user.id !== "number" && typeof user.id !== "string") {
    throw new Error("GitHub user id missing");
  }

  let email: string | null | undefined = typeof user.email === "string" ? user.email : null;
  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${accessToken}`,
        "user-agent": "erd-studio-oauth",
      },
      signal,
    });
    if (emailsRes.ok) {
      const emails = (await emailsRes.json()) as GitHubEmailResponse[];
      const primary = emails.find((item) => item.primary === true && item.verified === true && typeof item.email === "string");
      email = typeof primary?.email === "string" ? primary.email : null;
    } else {
      email = undefined;
    }
  }

  return {
    provider: "github",
    providerUserId: String(user.id),
    email,
    displayName: typeof user.name === "string" ? user.name : (typeof user.login === "string" ? user.login : null),
    avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null,
  };
}

export function registerOAuthRoutes(app: FastifyInstance, opts: OAuthRouteOptions): void {
  const sessionCookieName = opts.sessionCookieName ?? cookieNameFor(DEFAULT_SESSION_COOKIE_NAME, opts.secureCookie);
  const editorSessionCookieName = opts.editorSessionCookieName
    ?? cookieNameFor(DEFAULT_EDITOR_SESSION_COOKIE_NAME, opts.secureCookie);
  const flowCookieName = cookieNameFor(FLOW_COOKIE_BASENAME, opts.secureCookie);
  const sessionTtlMs = opts.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS;
  const oauthRateLimitDurationSeconds = opts.oauthRateLimitDurationSeconds
    ?? DEFAULT_OAUTH_RATE_LIMIT_DURATION_SECONDS;
  const oauthRateLimit = {
    max: opts.oauthRateLimitPoints ?? DEFAULT_OAUTH_RATE_LIMIT_POINTS,
    timeWindow: oauthRateLimitDurationSeconds * 1000,
  };

  app.get("/auth/me", async (req) => ({
    ok: true,
    user: userBody(req),
    aiAccessGrant: aiAccessGrantBody(req),
    canUseAI: hasAIAccess(req),
    canEdit: req.isEditor,
    editorRole: req.isAdmin ? "admin" : req.isEditor ? "editor" : null,
  }));

  app.post("/auth/logout", async (req, reply) => {
    const token = getSessionToken(req, sessionCookieName);
    const editorToken = getSessionToken(req, editorSessionCookieName);
    if (!ensureSameOriginRequest(req, reply, opts.appBaseUrl)) return;
    if (token) opts.authStore.deleteSessionByHash(hashSessionToken(token));
    if (editorToken) opts.editorSessionStore?.deleteEditorSessionByHash(hashSessionToken(editorToken));
    reply.header("set-cookie", [
      clearCookie(sessionCookieName, opts.secureCookie),
      clearCookie(editorSessionCookieName, opts.secureCookie, "Strict"),
    ]);
    return { ok: true };
  });

  app.register(async (oauthApp) => {
    await oauthApp.register(rateLimit, { global: false });

    oauthApp.get("/auth/oauth/github/start", { config: { rateLimit: oauthRateLimit } }, async (req, reply) => {
      if (!opts.githubClientId || !opts.githubClientSecret) {
        return reply.code(503).send({ ok: false, error: "GitHub OAuth is not configured" });
      }
      const state = createSessionToken();
      const stateHash = hashSessionToken(state);
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      opts.authStore.createOAuthState(stateHash, expiresAt);
      const callbackUrl = absoluteUrl(req, "/api/auth/oauth/github/callback", opts.appBaseUrl);
      const params = new URLSearchParams({
        client_id: opts.githubClientId,
        redirect_uri: callbackUrl,
        scope: "read:user user:email",
        state,
      });
      reply.header("set-cookie", serializeCookie(flowCookieName, stateHash, {
        httpOnly: true,
        maxAge: 10 * 60,
        sameSite: "Lax",
        secure: opts.secureCookie,
      }));
      return reply.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
    });

    oauthApp.get("/auth/oauth/github/callback", { config: { rateLimit: oauthRateLimit } }, async (req, reply) => {
      reply.header("set-cookie", clearCookie(flowCookieName, opts.secureCookie));
      if (!opts.githubClientId || !opts.githubClientSecret) {
        return reply.code(503).send({ ok: false, error: "GitHub OAuth is not configured" });
      }
      const query = req.query as { code?: unknown; state?: unknown };
      const cookieStateHash = getSessionToken(req, flowCookieName);
      if (typeof query.code !== "string" || typeof query.state !== "string" || !cookieStateHash) {
        return reply.code(400).send({ ok: false, error: "invalid OAuth state" });
      }
      const queryStateHash = hashSessionToken(query.state);
      if (queryStateHash !== cookieStateHash) {
        return reply.code(400).send({ ok: false, error: "invalid OAuth state" });
      }
      if (!opts.authStore.consumeOAuthState(queryStateHash, new Date().toISOString())) {
        return reply.code(400).send({ ok: false, error: "invalid OAuth state" });
      }

      const signal = AbortSignal.timeout(opts.oauthTimeoutMs ?? DEFAULT_OAUTH_TIMEOUT_MS);
      try {
        const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
          method: "POST",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify({
            client_id: opts.githubClientId,
            client_secret: opts.githubClientSecret,
            code: query.code,
            redirect_uri: absoluteUrl(req, "/api/auth/oauth/github/callback", opts.appBaseUrl),
          }),
          signal,
        });
        if (!tokenRes.ok) return reply.code(502).send({ ok: false, error: "GitHub OAuth token exchange failed" });
        const tokenData = (await tokenRes.json()) as GitHubTokenResponse;
        if (typeof tokenData.access_token !== "string") {
          return reply.code(502).send({ ok: false, error: "GitHub OAuth token missing" });
        }

        const userInput = await fetchGitHubUser(tokenData.access_token, signal);
        const user = opts.authStore.upsertOAuthUser(userInput);
        const sessionToken = createSessionToken();
        const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
        opts.authStore.createSession(user.id, hashSessionToken(sessionToken), expiresAt);
        reply.header("set-cookie", [
          clearCookie(flowCookieName, opts.secureCookie),
          serializeCookie(sessionCookieName, sessionToken, {
            httpOnly: true,
            maxAge: sessionTtlMs / 1000,
            sameSite: "Lax",
            secure: opts.secureCookie,
          }),
        ]);
        return reply.redirect("/");
      } catch (error) {
        if (signal.aborted) {
          return reply.code(504).send({ ok: false, error: "GitHub OAuth upstream timeout" });
        }
        oauthApp.log.error({ error }, "GitHub OAuth upstream request failed");
        return reply.code(502).send({ ok: false, error: "GitHub OAuth upstream request failed" });
      }
    });
  });
}

export { isActiveAIAccessGrant };
