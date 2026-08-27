# 공개 알파 릴리스

[English](RELEASING.md) | **한국어**

현재 개발 저장소에는 비공개 이력과 로컬 전용 도구가 포함될 수 있습니다. 해당 저장소를 그대로 공개하지 마세요.

## 소스 전용 squash 가져오기

1. 루트 README에 기록된 client/server 검증과 High/Critical audit을 완료합니다.
2. 검증된 작업 트리에서 추적 중이며 공개 대상으로 명시적으로 검토된 파일만 사용해 소스 archive를 만듭니다. `.git`, `.env*`, 데이터베이스, `artifacts/`, `node_modules/`, 빌드 결과물, 에디터 상태, 비공개 하네스 파일 및 인증정보는 제외합니다.
3. archive 파일 목록을 검사하고 압축을 푼 archive에 비밀정보 스캔을 실행합니다.
4. 공개 전 최종 검증을 위한 새로운 빈 비공개 저장소를 만듭니다.
5. 검증된 archive를 새 디렉터리에 풀고 새 Git 저장소를 초기화한 뒤 최초 릴리스 커밋 하나를 만듭니다.
6. CI, Dependabot 및 secret scanning을 활성화합니다. 공개 상태로 변경하기 전에 실패한 업데이트 Pull Request를 해결하거나 종료합니다.
7. 검증된 저장소를 공개로 변경하고 branch protection을 활성화한 뒤 공개 저장소 전용 CodeQL workflow를 실행합니다.
8. 필수 검사와 CodeQL 분석이 통과한 뒤에만 예정된 prerelease 버전에 tag를 지정합니다.

이미 공개된 tag를 이동하거나 덮어쓰지 마세요. 후속 수정은 `v0.1.0-alpha.1`과 같은 새로운 prerelease 버전으로 배포합니다.

비공개 저장소와 이력은 계속 비공개로 유지하세요. 소스 archive와 checksum이 전달 경계입니다. `.git` 객체를 복사하거나 mirror push를 사용하면 안 됩니다.

## 릴리스 차단 조건

다음 중 하나라도 있으면 릴리스하지 마세요.

- High/Critical 의존성 또는 보안 문제
- 실패한 제품 테스트나 빌드
- 해결되지 않은 Smart Merge 데이터 유실 버그
- secret scan 발견사항
- 라이선스 또는 보안 신고 경로 누락
