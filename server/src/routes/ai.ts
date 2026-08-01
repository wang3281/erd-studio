import type { FastifyInstance } from "fastify";
import { isIP } from "node:net";
import { ensureAIAccess, ensureSameOriginRequest } from "../auth.js";
import { CodexRequestError, type CodexCompletion } from "../codex-provider.js";

interface RouteOptions {
  aiProvider?: "litellm" | "codex";
  codexComplete?: CodexCompletion;
  litellmBaseUrl?: string;
  litellmApiKey?: string;
  litellmModel?: string;
  appBaseUrl?: string;
  shutdownSignal?: AbortSignal;
  /** upstream 응답 대기 한도(ms). 기본 110초 — nginx /api proxy_read_timeout(120s)보다 짧게. */
  upstreamTimeoutMs?: number;
}

const DEFAULT_UPSTREAM_TIMEOUT_MS = 110_000;

function isLoopbackAddress(address: string): boolean {
  if (address === "::1") return true;
  const ipv4 = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return isIP(ipv4) === 4 && Number(ipv4.split(".", 1)[0]) === 127;
}

export function registerAIRoutes(app: FastifyInstance, opts: RouteOptions): void {
  app.post("/ai/chat/completions", async (req, reply) => {
    const aiProvider = opts.aiProvider ?? "litellm";
    // AI 호출은 비용 발생 + 외부 네트워크 — 관리자 fallback 또는 OAuth AI access grant 보유자만 허용.
    if (!ensureAIAccess(req, reply)) return;
    if (!ensureSameOriginRequest(req, reply, opts.appBaseUrl)) return;
    if (aiProvider === "codex" && !req.isAdmin) {
      return reply.code(403).send({ error: "Codex subscription provider requires a local admin token" });
    }
    if (aiProvider === "codex" && !isLoopbackAddress(req.ip)) {
      return reply.code(403).send({ error: "Codex subscription provider requires a loopback client" });
    }
    const base = opts.litellmBaseUrl;
    if (aiProvider === "litellm" && !base) {
      return reply
        .code(503)
        .send({ error: "LITELLM_BASE_URL not configured on server" });
    }
    if (aiProvider === "codex" && !opts.codexComplete) {
      return reply.code(503).send({ error: "Codex provider not configured on server" });
    }
    if (opts.shutdownSignal?.aborted) {
      return reply.code(503).send({ error: "AI provider is shutting down" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    // LITELLM_MODEL 이 설정되면 서버가 모델을 강제(진실의 소스)하고, 미설정이면
    // 클라이언트가 보낸 model 을 그대로 upstream 에 전달한다(모델 선택을 클라이언트에 위임).
    const finalBody = opts.litellmModel
      ? { ...body, model: opts.litellmModel }
      : body;

    const url = aiProvider === "litellm"
      ? `${base!.replace(/\/+$/, "")}/chat/completions`
      : "codex://local";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (opts.litellmApiKey) {
      headers["Authorization"] = `Bearer ${opts.litellmApiKey}`;
    }

    // 느린/멈춘 upstream 이 요청을 무기한 점유하지 않도록 timeout, 클라이언트가 끊으면
    // upstream 호출(=비용)도 함께 취소되도록 disconnect 를 abort 로 전파한다.
    const controller = new AbortController();
    let abortCause: "disconnect" | "timeout" | "shutdown" | undefined;
    const timer = setTimeout(() => {
      if (abortCause !== undefined) return;
      abortCause = "timeout";
      controller.abort();
    }, opts.upstreamTimeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS);
    // 응답이 완료되기 전에 연결이 닫히면( = 클라이언트 disconnect) upstream 호출을 취소.
    // 정상 완료 시에도 close 는 발생하므로 writableEnded 로 구분한다.
    const onClientClose = () => {
      if (reply.raw.writableEnded) return;
      clearTimeout(timer);
      if (abortCause !== undefined) return;
      abortCause = "disconnect";
      controller.abort();
    };
    reply.raw.once("close", onClientClose);
    const onServerShutdown = () => {
      if (abortCause !== undefined) return;
      abortCause = "shutdown";
      clearTimeout(timer);
      controller.abort();
    };
    opts.shutdownSignal?.addEventListener("abort", onServerShutdown, { once: true });

    try {
      if (aiProvider === "codex") {
        try {
          const content = await opts.codexComplete!(body, controller.signal);
          return reply.send({
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                message: { content, role: "assistant" },
              },
            ],
          });
        } catch (err) {
          if (controller.signal.aborted) {
            if (abortCause === "shutdown") {
              app.log.info("server shutdown — Codex call aborted");
              return reply.code(503).send({ error: "Codex provider is shutting down" });
            }
            if (abortCause === "timeout") {
              app.log.error("Codex provider timeout");
              return reply.code(504).send({ error: "Codex provider timeout" });
            }
            app.log.info("client disconnected — Codex call aborted");
            return;
          }
          if (err instanceof CodexRequestError) {
            return reply.code(400).send({ error: err.message });
          }
          app.log.error({ err }, "Codex provider error");
          return reply.code(502).send({ error: "Codex provider failed" });
        }
      }

      let upstream: Response;
      try {
        upstream = await fetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(finalBody),
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          if (abortCause === "shutdown") {
            app.log.info({ url }, "server shutdown — LiteLLM call aborted");
            return reply.code(503).send({ error: "AI provider is shutting down" });
          }
          if (abortCause === "timeout") {
            app.log.error({ url }, "LiteLLM upstream timeout");
            return reply.code(504).send({ error: "LiteLLM upstream timeout" });
          }
          // 클라이언트가 먼저 끊은 경우 — 응답을 보낼 곳이 없으므로 조용히 종료
          app.log.info("client disconnected — LiteLLM call aborted");
          return;
        }
        app.log.error({ err }, "LiteLLM upstream error");
        return reply.code(502).send({ error: "LiteLLM unreachable" });
      }

      // upstream 의 auth 실패가 클라이언트의 자동 logout 으로 잘못 해석되지 않게 502 로 매핑.
      // (클라는 401/403 을 자기 토큰 만료로 해석함)
      if (upstream.status === 401 || upstream.status === 403) {
        app.log.error(
          { status: upstream.status },
          "LiteLLM rejected the server credentials — check LITELLM_API_KEY",
        );
        return reply.code(502).send({ error: "LiteLLM upstream auth error" });
      }

      // 본문 수신도 signal 의 보호를 받는다 (fetch 의 signal 은 body 읽기까지 적용됨)
      let text: string;
      try {
        text = await upstream.text();
      } catch (err) {
        if (controller.signal.aborted) {
          if (abortCause === "shutdown") {
            app.log.info({ url }, "server shutdown while reading LiteLLM body");
            return reply.code(503).send({ error: "AI provider is shutting down" });
          }
          if (abortCause === "timeout") {
            app.log.error({ url }, "LiteLLM upstream body timeout");
            return reply.code(504).send({ error: "LiteLLM upstream timeout" });
          }
          app.log.info("client disconnected while reading LiteLLM body");
          return;
        }
        app.log.error({ err }, "LiteLLM body read error");
        return reply.code(502).send({ error: "LiteLLM unreachable" });
      }
      reply.code(upstream.status);
      const ct = upstream.headers.get("content-type");
      if (ct) reply.header("content-type", ct);
      return reply.send(text);
    } finally {
      clearTimeout(timer);
      reply.raw.removeListener("close", onClientClose);
      opts.shutdownSignal?.removeEventListener("abort", onServerShutdown);
    }
  });
}
