import { describe, expect, it } from "vitest";
import { createAISettingsDraft, getAutoSelectedSuggestions } from "../aiModalState";
import type { ResolvedSuggestion } from "../../core/ai/types";

describe("getAutoSelectedSuggestions", () => {
  it("중복/미해결이 아닌 항목만 기본 선택한다", () => {
    const resolved = [
      { duplicate: false, unresolvable: false },
      { duplicate: true, unresolvable: false },
      { duplicate: false, unresolvable: true },
      { duplicate: false, unresolvable: false },
    ] as ResolvedSuggestion[];

    expect([...getAutoSelectedSuggestions(resolved)]).toEqual([0, 3]);
  });
});

describe("createAISettingsDraft", () => {
  it("apiKey가 없으면 빈 문자열로 초기화한다", () => {
    expect(createAISettingsDraft({ apiUrl: "http://localhost:4000/v1", model: "gpt-5.4" })).toEqual({
      apiUrl: "http://localhost:4000/v1",
      model: "gpt-5.4",
      apiKey: "",
    });
  });
});
