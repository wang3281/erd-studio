# ERD Studio

[English](README.md) | **한국어**

ERD Studio는 로컬 우선 방식의 시각적 데이터베이스 설계 도구입니다. MySQL 또는 PostgreSQL DDL을 붙여 넣어 ER 다이어그램을 확인하고 편집할 수 있으며, 증분 DDL을 안전하게 병합하고 모델을 SQL, DBML, Mermaid, PNG 또는 JSON으로 내보낼 수 있습니다.

> `0.1.0-alpha`: 평가 및 소규모 자체 호스팅 환경에 적합합니다. 중요한 작업은 백업하고, 생성된 DDL을 데이터베이스에 적용하기 전에 반드시 검토하세요.

![ERD Studio에 표시된 26개 테이블 규모의 마켓플레이스 스키마](docs/images/marketplace-overview.png)

## 주요 기능

- `CREATE TABLE`, `ALTER TABLE`, 외래 키, 주석, 고유성, NULL 허용 여부 및 자동 증가 메타데이터를 파싱합니다.
- Smart Merge는 기존 엔티티 ID, 위치, 수동 관계 및 입력 DDL에 포함되지 않은 테이블을 보존합니다.
- `Cmd/Ctrl+K`, 테이블·컬럼 검색, 키보드 선택 및 저배율 시맨틱 렌더링으로 대형 모델을 탐색할 수 있습니다.
- PostgreSQL, MySQL, DBML, Mermaid, PNG 및 무손실 ERD Studio JSON으로 내보낼 수 있습니다.
- 브라우저에서만 사용할 수 있으며, 선택 사항인 Fastify/SQLite 서버를 추가하면 프로젝트 공유와 AI 관계 제안을 사용할 수 있습니다.

공개 예제인 [`examples/marketplace-platform.sql`](examples/marketplace-platform.sql)에는 테이블 26개, 컬럼 242개, 외래 키 47개가 포함되어 있습니다. 함께 제공되는 증분 예제는 테이블 2개와 외래 키 5개를 추가하여 Smart Merge를 검증합니다.

## 빠른 시작

Node.js 20 또는 22를 지원합니다.

```bash
git clone <your-fork-url>
cd erd-studio

cd client
npm ci
npm run dev
```

`http://localhost:5173`을 여세요. 서버가 없어도 로컬에서 편집, 가져오기 및 내보내기를 사용할 수 있습니다. 상태 표시줄에는 `Local draft — Export JSON to keep`이 표시되며, 서버 Open/Save와 자동 저장은 비활성화됩니다.

공유 프로젝트를 활성화하려면 다음을 실행하세요.

```bash
cd server
cp .env.example .env
# EDIT_PASSWORD는 로컬에서 설정하세요. .env를 커밋하지 마세요.
npm ci
npm run dev
```

개발 중에는 Vite가 `/api` 요청을 `http://localhost:3001`로 프록시합니다.

## 보안 기본값

- 프로젝트 이름과 스키마는 기본적으로 비공개입니다. 익명 읽기 접근은 `PROJECT_READ_ACCESS=public`을 명시적으로 설정해야만 허용됩니다.
- 편집자·관리자 비밀번호는 토큰으로 반환되거나 브라우저에 저장되지 않습니다. 로그인하면 불투명하고 해시되며 만료되는 서버 세션과 HttpOnly `SameSite=Strict` 쿠키가 생성됩니다.
- 운영 모드는 HTTPS `APP_BASE_URL`과 `COOKIE_SECURE=true`가 없으면 시작되지 않습니다.
- 상태를 변경하는 요청은 설정된 동일 출처에서만 허용됩니다.
- OAuth 쿠키와 편집자 쿠키는 분리됩니다. Codex provider 모드는 loopback 전용입니다.

ERD 스키마와 AI 프롬프트에는 민감한 업무 정보가 포함될 수 있습니다. 앱을 인터넷에 공개하기 전에 [한국어 보안 정책](SECURITY.ko.md)과 [한국어 서버 배포 안내](server/README.ko.md)를 읽으세요.

## 검증

```bash
cd client
npm ci
npm run verify
npm audit --audit-level=high

cd ../server
npm ci
npm run typecheck
npm test
npm run build
npm audit --audit-level=high
```

CI는 Node.js 20과 22에서 위 검사를 실행하며, CodeQL, 비밀정보 스캔 및 High/Critical 의존성 게이트도 함께 실행합니다.

## 지원 범위와 제한사항

- 지원 배포 구성은 HTTPS 뒤의 Fastify 프로세스 1개와 SQLite 데이터베이스 1개입니다.
- 공유 편집자·관리자 비밀번호는 인스턴스 전체에 적용되며, 사용자별 프로젝트 ACL은 포함되지 않습니다.
- DDL 파서는 일반적인 MySQL/PostgreSQL 구문을 대상으로 하며, 모든 벤더 확장이나 프로시저 구문을 지원하지는 않습니다.
- Smart Merge는 의도적으로 부분 병합만 수행하며 입력 DDL에서 생략된 테이블을 삭제하지 않습니다. 전체 교체에는 Replace를 사용하세요.
- 로컬 초안은 내보내기 전까지 메모리에만 존재합니다. 서버 자동 저장은 프로젝트를 한 번 이상 저장하거나 연 뒤에 시작됩니다.

## 한국어 문서

- [기여 안내](CONTRIBUTING.ko.md)
- [보안 정책](SECURITY.ko.md)
- [행동강령](CODE_OF_CONDUCT.ko.md)
- [인터넷 배포 안내](deploy/README.ko.md)
- [공개 알파 릴리스 절차](docs/RELEASING.ko.md)
- [서버 운영 안내](server/README.ko.md)

[변경 이력](CHANGELOG.md)과 [Apache-2.0 라이선스](LICENSE)도 확인하세요.
