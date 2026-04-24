# 전자서명 Supabase 버전

기존 `전자서명` Google Apps Script 코드는 그대로 두고, 웹 배포용으로 새로 만든 프로젝트입니다.

이 버전은 메일 발송을 하지 않습니다. 관리자가 요청 링크를 생성하면 직접 복사해서 문자, 카카오톡, 메신저, 이메일 등에 전달하는 방식입니다.

## 구성

```text
전자서명_supabase/
  frontend/
    index.html
    src/
      app.js
      config.js
      styles.css
  supabase/
    config.toml
    migrations/
      001_initial_schema.sql
    functions/
      signature-api/
        index.ts
        deno.json
```

## 기능

- 공개 화면에서 양식 선택 후 직접 서명
- 관리자 로그인
- 요청 링크 생성
- 요청 링크 열람 상태 추적
- 요청 만료일 처리
- 서명 제출 저장
- 제출 문서 미리보기와 PDF 저장/인쇄
- 검증번호로 제출 이력 확인
- 관리자 양식 추가/수정

## 전체 배포 순서

이 문서는 Supabase CLI를 쓰지 않고 Supabase 웹페이지와 GitHub 웹페이지에서 배포하는 방법을 기준으로 작성했습니다.

1. Supabase 프로젝트 생성
2. Supabase SQL Editor에서 DB 스키마 실행
3. Supabase Dashboard에서 Edge Function 생성
4. Edge Function Secrets 설정
5. Supabase API 주소와 anon key 확인
6. `frontend/src/config.js` 수정
7. GitHub 저장소 생성
8. GitHub Pages 설정
9. 관리자 로그인 후 요청 링크 생성 테스트

## 1. Supabase 프로젝트 생성

1. https://supabase.com 접속
2. 로그인
3. `New project` 클릭
4. 프로젝트 이름 입력
5. Database Password 설정 HGQEmUifFYTY5MF3
6. Region 선택
7. 프로젝트 생성 완료까지 대기

프로젝트가 생성되면 왼쪽 메뉴에서 다음 화면들을 사용합니다.

- `SQL Editor`: DB 테이블 생성
- `Edge Functions`: 서버 API 생성
- `Project Settings > API`: API URL과 anon key 확인
- `Project Settings > Edge Functions`: Function Secrets 설정

## 2. DB 스키마 적용

1. Supabase Dashboard 왼쪽 메뉴에서 `SQL Editor` 클릭
2. `New query` 클릭
3. 이 프로젝트의 [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql) 파일 열기
4. 파일 내용을 전체 복사
5. Supabase SQL Editor에 붙여넣기
6. `Run` 클릭

실행 후 `Table Editor`에서 아래 테이블이 생성되었는지 확인합니다.

- `app_settings`
- `templates`
- `signature_requests`
- `submissions`
- `audit_logs`
- `admin_sessions`

기본 양식도 `templates` 테이블에 자동으로 들어갑니다.

## 3. Edge Function 생성

1. Supabase Dashboard 왼쪽 메뉴에서 `Edge Functions` 클릭
2. `Create a new function` 또는 `New function` 클릭
3. 함수 이름을 아래처럼 입력

```text
signature-api
```

4. 이 프로젝트의 [supabase/functions/signature-api/index.ts](./supabase/functions/signature-api/index.ts) 파일 열기
5. 파일 내용을 전체 복사
6. Supabase Edge Function 편집기에 붙여넣기
7. 저장 또는 배포 버튼 클릭

함수 URL은 보통 아래 형식입니다.

```text
https://skimhhrifivmffdtnoik.supabase.co/functions/v1/signature-api
```

Supabase Dashboard의 Edge Function 상세 화면에서 실제 Function URL을 확인할 수 있습니다.

## 4. Edge Function 인증 설정

이 프로젝트의 프론트엔드는 Supabase `anon public key`를 함께 보내도록 되어 있습니다.

따라서 Dashboard에서 Function이 JWT 인증을 요구하는 기본 설정이어도 동작할 수 있습니다. 만약 Supabase 화면에 `Verify JWT`, `Require JWT`, `JWT verification` 같은 설정이 보이면 켜둬도 됩니다.

단, Function URL과 anon key를 [frontend/src/config.js](./frontend/src/config.js)에 반드시 넣어야 합니다.

## 5. Edge Function Secrets 설정

Supabase Dashboard에서 Secret을 설정합니다.

1. 왼쪽 아래 `Project Settings` 클릭
2. `Edge Functions` 메뉴 클릭
3. `Secrets` 또는 `Environment variables` 영역으로 이동
4. 아래 값을 추가

### ADMIN_PASSWORD

관리자 로그인 비밀번호입니다.

```text
ADMIN_PASSWORD
```

값 예시:

```text
my-secure-password
```

### PUBLIC_SITE_URL

GitHub Pages 배포 주소입니다.

처음에는 아직 GitHub Pages 주소가 없을 수 있습니다. 그 경우 임시로 아래처럼 넣어도 됩니다.

```text
PUBLIC_SITE_URL
```

값 예시:

```text
https://kijung4290.github.io/YOUR_REPOSITORY
```

GitHub Pages 주소가 확정되면 이 값을 실제 주소로 다시 수정합니다.

## 6. Supabase API URL과 anon key 확인

1. Supabase Dashboard 왼쪽 아래 `Project Settings` 클릭
2. `API` 클릭
3. 아래 값을 확인

### Project URL

보통 아래 형식입니다.

```text
https://skimhhrifivmffdtnoik.supabase.co
```

### anon public key

`Project API keys` 또는 `API keys` 영역에서 `anon` / `public` key를 복사합니다.

이 키는 브라우저에 공개되는 키입니다. Supabase에서 브라우저 앱에 사용하도록 제공하는 공개 키입니다.

## 7. 프론트엔드 설정

[frontend/src/config.js](./frontend/src/config.js)를 엽니다.

아래 두 값을 수정합니다.

```js
window.ESIGN_CONFIG = {
  API_URL: "https://skimhhrifivmffdtnoik.supabase.co/functions/v1/signature-api",
  ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNraW1oaHJpZml2bWZmZHRub2lrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwMDIzMzUsImV4cCI6MjA5MjU3ODMzNX0.xKTLJ3PRJ0quXzFjg0cCkNA8HGXVy2dfHQ2pprG2vDg"
};
```

예시:

```js
window.ESIGN_CONFIG = {
  API_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1/signature-api",
  ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
};
```

주의: `ANON_KEY`에는 `service_role` 키를 넣으면 안 됩니다. 반드시 `anon public` 키를 넣습니다.

## 8. GitHub 저장소 생성

GitHub에서 새 저장소를 만듭니다.

예시 저장소 이름:

```text
esign
```

이 프로젝트는 전체 폴더를 GitHub 저장소에 올리는 구조입니다. 포함된 GitHub Actions가 `frontend` 폴더만 GitHub Pages로 배포합니다.

GitHub 저장소 루트 구조는 아래처럼 됩니다.

```text
your-github-repo/
  .github/
    workflows/
      pages.yml
  frontend/
    index.html
    src/
      app.js
      config.js
      styles.css
  supabase/
    migrations/
    functions/
  README.md
```

## 9. GitHub 웹페이지에서 파일 올리기

GitHub Desktop이나 Git 명령어를 쓰지 않는 경우 웹페이지에서 직접 올릴 수 있습니다.

1. GitHub 저장소 접속
2. `Add file` 클릭
3. `Upload files` 클릭
4. `전자서명_supabase` 안의 파일과 폴더를 업로드
5. `.github/workflows/pages.yml`, `frontend`, `supabase`, `README.md`가 저장소에 들어갔는지 확인
6. `Commit changes` 클릭

명령어로 푸시하는 경우에는 이 폴더 전체를 저장소 루트로 올리면 됩니다.

## 10. GitHub Pages 설정

GitHub 저장소에서 다음 순서로 설정합니다.

1. 저장소 페이지로 이동
2. `Settings` 클릭
3. 왼쪽 메뉴에서 `Pages` 클릭
4. `Build and deployment` 영역으로 이동
5. `Source`를 `GitHub Actions`로 선택
6. 저장

이 프로젝트에는 [.github/workflows/pages.yml](./.github/workflows/pages.yml)이 포함되어 있습니다. `main` 브랜치에 푸시하면 `frontend` 폴더가 자동으로 GitHub Pages에 배포됩니다.

배포 상태는 저장소의 `Actions` 탭에서 확인할 수 있습니다.

만약 GitHub Actions를 쓰지 않고 직접 배포하려면 `frontend` 폴더 안의 파일만 별도 저장소 루트에 올린 뒤 `Deploy from a branch`와 `/root`를 선택하면 됩니다.
8. `Save` 클릭

잠시 후 GitHub Pages 주소가 생성됩니다.

주소 형식은 보통 아래와 같습니다.

```text
https://YOUR_GITHUB_ID.github.io/YOUR_REPOSITORY/
```

예시:

```text
https://wonju-center.github.io/esign/
```

## 11. PUBLIC_SITE_URL 다시 설정

GitHub Pages 주소가 확정되면 Supabase Dashboard에서 Secret을 다시 수정합니다.

1. Supabase Dashboard 접속
2. `Project Settings` 클릭
3. `Edge Functions` 클릭
4. `Secrets` 또는 `Environment variables` 이동
5. `PUBLIC_SITE_URL` 값을 실제 GitHub Pages 주소로 수정

예시:

```text
https://wonju-center.github.io/esign
```

이 값은 관리자 화면에서 요청 링크를 생성할 때 사용됩니다.

## 12. 배포 테스트

GitHub Pages 주소로 접속합니다.

1. 우측 상단 `관리자` 클릭
2. `ADMIN_PASSWORD`로 설정한 비밀번호 입력
3. `요청 링크` 탭에서 양식 선택
4. 수신자 이름과 만료일 입력
5. `요청 링크 생성` 클릭
6. 생성된 링크 복사
7. 새 브라우저 탭에서 링크 접속
8. 문서 작성 및 서명 제출
9. 관리자 화면의 `제출 문서`에서 제출 내역 확인
10. 검증번호로 `검증` 화면에서 이력 확인

## 양식 태그

템플릿 본문 HTML 안에서 아래 태그를 사용할 수 있습니다.

```text
[[text:성명|required|placeholder=성명을 입력하세요]]
[[date:작성일|required]]
[[check:동의|required|label=내용을 확인했습니다.]]
[[sign:본인서명|required|role=본인]]
```

옵션:

- `required`: 필수 항목
- `optional`: 선택 항목
- `placeholder=...`: 입력 안내 문구
- `label=...`: 체크박스 표시 문구
- `role=...`: 서명 역할명
- `size=medium|wide|full`: 입력칸 크기

## 보안 메모

- 프론트엔드는 Supabase DB에 직접 접근하지 않고 Edge Function만 호출합니다.
- 브라우저에는 `anon public key`만 넣습니다.
- `service_role` 키는 절대 GitHub에 올리면 안 됩니다.
- DB 테이블은 RLS가 켜져 있으며 공개 정책을 만들지 않았습니다.
- 서버 함수는 Supabase Edge Function 내부의 Service Role 권한으로 DB 작업을 처리합니다.
- 관리자 비밀번호는 GitHub 코드에 넣지 말고 Supabase Secret `ADMIN_PASSWORD`로만 설정합니다.
- 서명과 개인정보가 저장되므로 Supabase 계정 보안, 관리자 비밀번호 관리, 접근 권한 관리를 신중히 해야 합니다.

## 문제 해결

### 화면에서 API_URL 설정 오류가 뜨는 경우

[frontend/src/config.js](./frontend/src/config.js)의 `API_URL`이 아직 기본값입니다. Supabase Edge Function URL로 변경해야 합니다.

### 화면에서 ANON_KEY 설정 오류가 뜨는 경우

[frontend/src/config.js](./frontend/src/config.js)의 `ANON_KEY`가 아직 기본값입니다. Supabase Dashboard의 `Project Settings > API`에서 `anon public key`를 복사해 넣습니다.

### 관리자 로그인이 안 되는 경우

Supabase Dashboard의 Edge Function Secrets에서 `ADMIN_PASSWORD`가 맞는지 확인합니다.

비밀번호를 바꿨다면 Edge Function 상세 화면에서 다시 저장 또는 재배포합니다.

### 요청 링크가 localhost 또는 잘못된 주소로 생성되는 경우

Supabase Dashboard의 Edge Function Secrets에서 `PUBLIC_SITE_URL`을 실제 GitHub Pages 주소로 수정합니다.

### DB 테이블이 없다는 오류가 나는 경우

Supabase SQL Editor에서 [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql) 내용을 다시 실행합니다.

### Edge Function 호출이 401 또는 Unauthorized로 실패하는 경우

1. [frontend/src/config.js](./frontend/src/config.js)의 `ANON_KEY`가 `anon public key`인지 확인
2. `service_role` 키를 넣지 않았는지 확인
3. `API_URL`이 `https://YOUR_PROJECT_REF.supabase.co/functions/v1/signature-api` 형식인지 확인
4. Edge Function 이름이 정확히 `signature-api`인지 확인
