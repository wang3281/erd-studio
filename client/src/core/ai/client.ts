import type { Entity, Relation } from "../model/types";
import type { AIConfig, AIInferenceResult, AIRelationSuggestion } from "./types";
import { serializeSchemaForPrompt, buildPromptMessages } from "./prompt";

function getAIRequestErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "The AI request was cancelled or timed out. Please try again.";
  }

  if (error instanceof TypeError) {
    return "Unable to reach the AI endpoint. Check the API URL and network connection.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "The AI request failed. Please try again.";
}

export async function inferRelationsWithAI(
  config: AIConfig,
  entities: Entity[],
  existingRelations: Relation[],
  signal?: AbortSignal,
): Promise<AIInferenceResult> {
  const schemaText = serializeSchemaForPrompt(entities, existingRelations);
  const messages = buildPromptMessages(schemaText);

  const url = `${config.apiUrl.replace(/\/+$/, "")}/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
      credentials: "same-origin",
      signal,
    });
  } catch (error) {
    throw new Error(getAIRequestErrorMessage(error), { cause: error });
  }

  if (!response.ok) {
    if (response.status === 401) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("erd-auth-fail"));
      }
      throw new Error("Sign in or unlock an editor session to use AI infer.");
    }
    if (response.status === 403) {
      throw new Error("Admin or AI access grant required for AI infer.");
    }
    if (response.status === 402) {
      throw new Error("AI access is not enabled for this account.");
    }
    if (response.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    const text = await response.text().catch(() => "");
    throw new Error(`API error (${response.status}): ${text || response.statusText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Unexpected API response format");
  }

  return parseAIResponse(content);
}

function parseAIResponse(content: string): AIInferenceResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Failed to parse AI response as JSON");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("AI response is not a valid object");
  }

  const obj = parsed as Record<string, unknown>;
  const summary = typeof obj.summary === "string" ? obj.summary : "";
  const rawSuggestions = Array.isArray(obj.suggestions) ? obj.suggestions : [];

  const validCardinalities = new Set(["1:1", "1:N", "N:1", "N:M"]);
  const validConfidences = new Set(["high", "medium", "low"]);

  const suggestions: AIRelationSuggestion[] = rawSuggestions
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .filter(
      (s) =>
        typeof s.sourceEntityName === "string" &&
        typeof s.sourceColumnName === "string" &&
        typeof s.targetEntityName === "string" &&
        typeof s.targetColumnName === "string",
    )
    .map((s) => ({
      sourceEntityName: s.sourceEntityName as string,
      sourceColumnName: s.sourceColumnName as string,
      targetEntityName: s.targetEntityName as string,
      targetColumnName: s.targetColumnName as string,
      cardinality: validCardinalities.has(s.cardinality as string)
        ? (s.cardinality as AIRelationSuggestion["cardinality"])
        : "N:1",
      reasoning: typeof s.reasoning === "string" ? s.reasoning : "",
      confidence: validConfidences.has(s.confidence as string)
        ? (s.confidence as AIRelationSuggestion["confidence"])
        : "medium",
    }));

  return { summary, suggestions };
}
