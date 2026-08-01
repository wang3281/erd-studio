// AI 설정은 서버측 환경변수로 단일화되었다. (LITELLM_BASE_URL / LITELLM_API_KEY)
// 클라이언트 측 settings 모달은 더 이상 노출하지 않는다.
// 컴포넌트는 기존 import 호환성을 위해 남겨두되 아무것도 렌더링하지 않는다.

export function AISettingsModal() {
  return null;
}
