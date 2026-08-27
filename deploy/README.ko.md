# 인터넷 배포

[English](README.md) | **한국어**

ERD Studio가 알파 단계에서 지원하는 배포 구성은 HTTPS reverse proxy 뒤에 정적 Vite 빌드와 Fastify/SQLite 프로세스 1개를 두는 방식입니다.

1. `client/`를 빌드하고 `client/dist/`를 nginx document root로 배포합니다.
2. `server/`를 빌드하고 loopback에서 비특권 서비스로 실행합니다.
3. SQLite 데이터베이스는 소스 트리 밖에 저장하고 서비스 계정만 접근할 수 있도록 권한을 설정합니다.
4. `NODE_ENV=production`, HTTPS `APP_BASE_URL`, `COOKIE_SECURE=true`를 설정합니다.
5. 저장된 모든 스키마를 의도적으로 공개하는 경우가 아니라면 `PROJECT_READ_ACCESS=private`을 유지합니다.
6. `nginx/erd.conf`의 모든 placeholder를 교체하고 신뢰할 수 있는 인증서를 설치한 뒤 `nginx -t`를 실행하세요. 검사가 성공한 경우에만 nginx를 reload합니다.

nginx 템플릿은 HSTS, 제한적인 CSP, frame 차단, content-type 보호 및 referrer/permissions 정책을 추가합니다. 외부 asset이나 analytics를 추가하기 전에 CSP를 검토하세요.

저장소에는 실제 인프라 인증정보나 배포 증거가 포함되지 않습니다. 비공개 저장소를 공개하기 전에는 검증된 깨끗한 소스 트리를 새로운 공개 저장소에 squash commit으로 가져오세요. 비공개 저장소의 이력을 공개하면 안 됩니다. 공개 전에 archive에 로컬 데이터베이스, `.env` 파일, artifacts, 개인 하네스 파일 및 비밀정보가 없는지 검사하세요.
