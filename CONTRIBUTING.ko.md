# ERD Studio 기여 안내

[English](CONTRIBUTING.md) | **한국어**

ERD Studio 개선에 도움을 주셔서 감사합니다. 현재 알파 단계이므로 범위가 명확한 버그 수정, 파서 호환성 개선, 접근성 작업 및 보안 강화가 특히 유용합니다.

## 변경을 제안하기 전에

- 기존 이슈를 검색하고, 하나의 Pull Request에는 하나의 문제 묶음만 포함하세요.
- 실제 스키마, 비밀번호, 토큰, 고객 데이터 또는 AI 프롬프트를 이슈, fixture, 로그나 스크린샷에 포함하지 마세요.
- 보안 취약점은 공개 이슈를 만들지 말고 [보안 정책](SECURITY.ko.md)을 따르세요.
- 이슈에서 breaking change를 명시적으로 제안하지 않았다면 기존 프로젝트 파일과 동작을 보존하세요.

## 로컬 검사

Node.js 20 또는 22를 사용하세요.

```bash
cd client
npm ci
npm run verify

cd ../server
npm ci
npm run typecheck
npm test
npm run build
```

파서 또는 Smart Merge 변경에는 `client/src/core/parser/__tests__` 또는 `client/src/core/merge/__tests__` 아래에 최소 회귀 테스트를 추가해야 합니다. 인증과 프로젝트 접근 변경은 관련 `401`, `403`, 세션 만료, 로그아웃 및 동일 출처 사례를 검증해야 합니다.

## Pull Request

사용자에게 보이는 동작, 실행한 검증 명령 및 남아 있는 제한사항을 설명하세요. 생성 파일, 로컬 데이터베이스, 브라우저 산출물 및 관련 없는 포맷 변경은 포함하지 마세요. 기여 내용은 저장소의 Apache-2.0 라이선스 조건으로 제공됩니다.
