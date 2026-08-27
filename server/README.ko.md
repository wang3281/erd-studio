# ERD Studio 서버

[English](README.md) | **한국어**

선택 사항인 ERD Studio 서버는 공유 프로젝트 저장소, 편집자·관리자 세션, GitHub OAuth AI 접근 및 AI provider routing을 제공합니다. 지원 구성은 Fastify 프로세스 1개와 SQLite 데이터베이스 1개입니다.

## 인증과 프로젝트 접근

`POST /api/auth/login`은 동일 출처에서 `{password}`를 받습니다. 성공 응답에는 `{ok, role}`만 포함되며 불투명한 편집자 세션 쿠키가 설정됩니다. 원본 비밀번호는 bearer token이 아니며 반환되지 않습니다. 세션 토큰은 256-bit 난수이고 SQLite에는 SHA-256 해시만 저장됩니다. 세션은 기본적으로 8시간 후 만료됩니다.

프로젝트 읽기는 기본적으로 비공개입니다.

| Method | Path | 접근 권한 |
|---|---|---|
| GET | `/healthz` | 익명 |
| POST | `/api/auth/login` | 동일 출처 비밀번호 로그인 |
| GET | `/api/auth/me` | 익명 세션 요약 |
| POST | `/api/auth/editor/logout` | 동일 출처 편집자 세션 로그아웃 |
| POST | `/api/auth/logout` | 동일 출처 OAuth + 편집자 전체 로그아웃 |
| GET | `/api/projects` | 편집자 세션 또는 `PROJECT_READ_ACCESS=public`일 때 익명 |
| GET | `/api/projects/:name` | 편집자 세션 또는 `PROJECT_READ_ACCESS=public`일 때 익명 |
| PUT | `/api/projects/:name` | 동일 출처 편집자·관리자 세션 |
| DELETE | `/api/projects/:name` | 동일 출처 편집자·관리자 세션 |
| POST | `/api/ai/chat/completions` | 동일 출처 관리자 세션 또는 활성화된 OAuth AI 권한. Codex는 로컬 관리자만 가능 |

OAuth와 편집자 세션은 서로 다른 쿠키를 사용합니다. 편집자 쿠키는 로컬 HTTP 개발 환경에서 `erd-editor-session`, 보안 운영 환경에서 `__Host-erd-editor-session`입니다. OAuth 세션 쿠키는 별도로 유지됩니다.

## 설정

로컬 개발 시 `.env.example`을 `.env`로 복사하고 값을 로컬에서 입력하세요.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `EDIT_PASSWORD` | 필수 | 인스턴스 전체 편집자 비밀번호 |
| `ADMIN_PASSWORD` | 미설정 | 자체 호스팅 AI fallback을 위한 별도 관리자 비밀번호 |
| `PROJECT_READ_ACCESS` | `private` | `private` 또는 명시적인 익명 `public` 읽기 |
| `EDITOR_SESSION_TTL_HOURS` | `8` | 편집자·관리자 세션 수명. 0보다 크고 최대 168 |
| `APP_BASE_URL` | 개발 환경에서는 요청 origin | 공개 origin. 운영 환경에서는 HTTPS 필수 |
| `COOKIE_SECURE` | `false` | 운영 환경에서는 `true` 필수 |
| `DB_PATH` | `./erd.db` | SQLite 데이터베이스 경로 |
| `HOST` | `127.0.0.1` | listen 주소 |
| `PORT` | `3001` | listen port |
| `AI_PROVIDER` | `litellm` | `litellm` 또는 loopback 전용 `codex` |
| `LITELLM_BASE_URL` | 미설정 | OpenAI 호환 upstream |
| `LITELLM_API_KEY` | 미설정 | upstream 인증정보 |
| `LITELLM_MODEL` | 미설정 | 서버에서 강제할 선택적 model |
| `CODEX_MODEL` | Codex 기본값 | 선택적 로컬 subscription model |
| `GITHUB_OAUTH_CLIENT_ID` | 미설정 | GitHub OAuth application ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | 미설정 | GitHub OAuth secret |
| `LOG_LEVEL` | `info` | Fastify log level |

운영 모드는 `APP_BASE_URL`이 HTTPS를 사용하지 않거나 `COOKIE_SECURE=true`가 아니면 시작되지 않습니다.

## 실행과 검증

```bash
cd server
npm ci
npm run dev

npm run typecheck
npm test
npm run build
```

운영 환경에서는 먼저 빌드한 뒤 nginx 템플릿 뒤에서 비특권 서비스 사용자로 `node --enable-source-maps dist/index.js`를 실행하세요. 템플릿은 `deploy/nginx/erd.conf`에 있습니다.

## SQLite 수명주기

서버 시작 시 짧은 `CREATE TABLE/INDEX IF NOT EXISTS` 문으로 additive `editor_sessions` 테이블과 인덱스를 생성합니다. 프로젝트 row는 다시 쓰거나 backfill하지 않습니다. 이전 binary로 rollback해도 테이블을 그대로 둘 수 있으며 프로젝트 데이터에는 영향을 주지 않습니다. 새로 발급된 편집자 세션은 이전 binary에서 인식되지 않습니다. 의도적인 offline 정리 작업에서만 테이블을 제거하세요.

실시간 백업에는 SQLite 온라인 백업 기능을 사용하세요.

```bash
sqlite3 /var/lib/erd/erd.db ".backup '/secure-backups/erd.db'"
```

데이터베이스와 환경 파일은 서비스 계정만 접근할 수 있도록 제한하세요.
