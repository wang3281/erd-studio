import type { Cardinality } from "../model/types";

export interface AIConfig {
  apiUrl: string;
  model: string;
  apiKey?: string;
}

export interface AIRelationSuggestion {
  sourceEntityName: string;
  sourceColumnName: string;
  targetEntityName: string;
  targetColumnName: string;
  cardinality: Cardinality;
  reasoning: string;
  confidence: "high" | "medium" | "low";
}

export interface AIInferenceResult {
  suggestions: AIRelationSuggestion[];
  summary: string;
}

export type AIRequestState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: AIInferenceResult }
  | { status: "error"; message: string };

export interface ResolvedSuggestion {
  suggestion: AIRelationSuggestion;
  sourceEntityId: string;
  sourceColumnId: string;
  targetEntityId: string;
  targetColumnId: string;
  duplicate: boolean;
  unresolvable: boolean;
  unresolvableReason?: string;
}
