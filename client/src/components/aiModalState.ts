import type { AIConfig, ResolvedSuggestion } from "../core/ai/types";

export interface AISettingsDraft {
  apiUrl: string;
  model: string;
  apiKey: string;
}

export function getAutoSelectedSuggestions(resolved: ResolvedSuggestion[]): Set<number> {
  const selected = new Set<number>();

  resolved.forEach((suggestion, index) => {
    if (!suggestion.unresolvable && !suggestion.duplicate) {
      selected.add(index);
    }
  });

  return selected;
}

export function createAISettingsDraft(config: AIConfig): AISettingsDraft {
  const { apiUrl, model, apiKey = "" } = config;
  return {
    apiUrl,
    model,
    apiKey,
  };
}
