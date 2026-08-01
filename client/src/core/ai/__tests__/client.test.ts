import { describe, it, expect, vi, beforeEach } from "vitest";
import { inferRelationsWithAI } from "../client";
import type { AIConfig } from "../types";
import { createEntity, createColumn } from "../../model/factory";

const config: AIConfig = { apiUrl: "http://localhost:4000/v1", model: "test-model" };
const eventTarget = new EventTarget();

function makeEntities() {
  const col = createColumn({ name: "id", type: "INT", isPrimaryKey: true });
  return [createEntity({ name: "users", columns: [col] })];
}

function mockFetchResponse(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => eventTarget.dispatchEvent(event),
    },
  });
});

describe("inferRelationsWithAI", () => {
  it("parses a valid response", async () => {
    const apiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "Found 1 relation",
              suggestions: [
                {
                  sourceEntityName: "orders",
                  sourceColumnName: "user_id",
                  targetEntityName: "users",
                  targetColumnName: "id",
                  cardinality: "N:1",
                  reasoning: "FK pattern",
                  confidence: "high",
                },
              ],
            }),
          },
        },
      ],
    };

    globalThis.fetch = mockFetchResponse(apiResponse);

    const result = await inferRelationsWithAI(config, makeEntities(), []);

    expect(result.summary).toBe("Found 1 relation");
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0].sourceEntityName).toBe("orders");
  });

  it("throws on HTTP error", async () => {
    globalThis.fetch = mockFetchResponse({}, 500);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow("API error (500)");
  });

  it("throws on rate limit", async () => {
    globalThis.fetch = mockFetchResponse({}, 429);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow("Rate limit");
  });

  it("notifies the app when the AI proxy rejects the cookie session", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    globalThis.fetch = mockFetchResponse({ error: "bad api key" }, 401);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow(
      "Sign in or unlock an editor session to use AI infer.",
    );

    expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: "erd-auth-fail" }));
  });

  it("does not invalidate the editor session when AI proxy requires a stronger permission", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    globalThis.fetch = mockFetchResponse({ error: "admin required" }, 403);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow(
      "Admin or AI access grant required for AI infer.",
    );

    expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: "erd-auth-fail" }));
  });

  it("sends credentials without an Authorization header", async () => {
    const fetchMock = mockFetchResponse({
      choices: [{ message: { content: '{"summary":"","suggestions":[]}' } }],
    });
    globalThis.fetch = fetchMock;

    await inferRelationsWithAI({ ...config, apiKey: "must-not-be-sent" }, makeEntities(), []);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/v1/chat/completions",
      expect.objectContaining({
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  it("maps connectivity failures to endpoint guidance", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow(
      "Unable to reach the AI endpoint. Check the API URL and network connection.",
    );
  });

  it("maps aborted requests to timeout guidance", async () => {
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow(
      "The AI request was cancelled or timed out. Please try again.",
    );
  });

  it("handles malformed JSON in response content", async () => {
    const apiResponse = {
      choices: [{ message: { content: "not json" } }],
    };
    globalThis.fetch = mockFetchResponse(apiResponse);

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow("parse");
  });

  it("handles missing choices", async () => {
    globalThis.fetch = mockFetchResponse({ choices: [] });

    await expect(inferRelationsWithAI(config, makeEntities(), [])).rejects.toThrow("Unexpected");
  });

  it("filters out invalid suggestions", async () => {
    const apiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              summary: "test",
              suggestions: [
                { sourceEntityName: "a", sourceColumnName: "b", targetEntityName: "c", targetColumnName: "d", cardinality: "N:1", reasoning: "ok", confidence: "high" },
                { bad: "data" },
                "not an object",
              ],
            }),
          },
        },
      ],
    };
    globalThis.fetch = mockFetchResponse(apiResponse);

    const result = await inferRelationsWithAI(config, makeEntities(), []);
    expect(result.suggestions).toHaveLength(1);
  });
});
