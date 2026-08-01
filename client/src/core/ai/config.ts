import type { AIConfig } from "./types";

// AI 호출은 백엔드(/api/ai) 프록시를 거친다.
// LiteLLM endpoint / API key 는 서버측 환경변수로 단일화되어 클라이언트 번들에 노출되지 않는다.
// 인증은 동일 출처 HttpOnly 쿠키로만 처리한다.

export function getDefaultAIConfig(): AIConfig {
  return {
    apiUrl: "/api/ai",
    model: "gpt-5.4",
  };
}

// 후방 호환용 — 더 이상 클라이언트 측에서 AI 설정을 별도로 보관하지 않는다.
export function loadAIConfig(): AIConfig | null {
  return getDefaultAIConfig();
}

// no-op — 설정 변경은 서버 환경변수로만 가능
export function saveAIConfig(_config: AIConfig): void {
  void _config;
}
