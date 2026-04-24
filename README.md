# 전자서명 Supabase 버전

기존 `전자서명` Google Apps Script 코드는 그대로 두고, GitHub Pages와 Supabase로 배포할 수 있게 만든 버전입니다.

메일 발송 기능은 없습니다. 관리자가 요청 링크를 생성하고, 그 링크를 문자, 카카오톡, 메신저, 이메일 등에 직접 전달하는 방식입니다.

## 현재 저장소 구조

GitHub Pages의 `Deploy from a branch` + `/root` 방식으로 바로 배포할 수 있도록 `index.html`을 저장소 루트에 둡니다.

```text
esign/
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
  README.md
```

## 전체 배포 순서

이 문서는 Supabase CLI 없이 Supabase 웹페이지와 GitHub 웹페이지에서 설정하는 방식입니다.

1. Supabase 프로젝트 생성
2. Supabase SQL Editor에서 DB 스키마 실행
3. Supabase Dashboard에서 Edge Function 생성
4. Edge Function Secrets 설정
5. Supabase API 주소와 anon key 확인
6. `src/config.js` 수정
7. GitHub 저장소에 파일 업로드 또는 푸시
8. GitHub Pages를 `/root`로 설정
9. 관리자 로그인 후 요청 링크 생성 테스트

## 1. Supabase 프로젝트 생성

1. https://supabase.com 접속
2. 로그인
3. `New project` 클릭
4. 프로젝트 이름 입력
5. Database Password 설정
6. Region 선택
7. 프로젝트 생성 완료까지 대기

프로젝트가 생성되면 아래 메뉴를 사용합니다.

- `SQL Editor`: DB 테이블 생성
- `Edge Functions`: 서버 API 생성
- `Project Settings > API`: API URL과 anon key 확인
- `Project Settings > Edge Functions`: Function Secrets 설정

## 2. DB 스키마 적용

1. Supabase Dashboard 왼쪽 메뉴에서 `SQL Editor` 클릭
2. `New query` 클릭
3. [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql) 파일 내용 전체 복사
4. SQL Editor에 붙여넣기
5. `Run` 클릭

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
3. 함수 이름을 `signature-api`로 입력
4. [supabase/functions/signature-api/index.ts](./supabase/functions/signature-api/index.ts) 파일 내용 전체 복사
5. Supabase Edge Function 편집기에 붙여넣기
6. 저장 또는 배포

Function URL 형식:

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/signature-api
```

## 4. Edge Function Secrets 설정

Supabase Dashboard에서 Secret을 설정합니다.

1. `Project Settings` 클릭
2. `Edge Functions` 메뉴 클릭
3. `Secrets` 또는 `Environment variables` 영역으로 이동
4. 아래 값을 추가

관리자 비밀번호:

```text
ADMIN_PASSWORD=원하는관리자비밀번호
```

GitHub Pages 주소:

```text
PUBLIC_SITE_URL=https://kijung4290.github.io/esign
```

GitHub Pages 주소가 아직 확정되지 않았다면 임시로 넣고, Pages 주소가 나온 뒤 다시 수정합니다.

## 5. Supabase API URL과 anon key 확인

1. Supabase Dashboard 왼쪽 아래 `Project Settings` 클릭
2. `API` 클릭
3. `Project URL` 확인
4. `Project API keys` 또는 `API keys` 영역에서 `anon public key` 복사

주의: `service_role` 키는 절대 GitHub에 올리면 안 됩니다. 브라우저에는 `anon public key`만 넣습니다.

## 6. 프론트엔드 설정

[src/config.js](./src/config.js)를 엽니다.

아래 두 값을 본인 Supabase 프로젝트 값으로 수정합니다.

```js
window.ESIGN_CONFIG = {
  API_URL: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/signature-api",
  ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY"
};
```

## 7. GitHub 저장소에 업로드

저장소 루트에 아래 파일 구조가 그대로 있어야 합니다.

```text
index.html
src/app.js
src/config.js
src/styles.css
supabase/migrations/001_initial_schema.sql
supabase/functions/signature-api/index.ts
README.md
```

현재 저장소는 이 구조로 맞춰져 있으므로 그대로 푸시하면 됩니다.

## 8. GitHub Pages 설정

GitHub 저장소에서 다음 순서로 설정합니다.

1. 저장소 페이지로 이동
2. `Settings` 클릭
3. 왼쪽 메뉴에서 `Pages` 클릭
4. `Build and deployment` 영역으로 이동
5. `Source`를 `Deploy from a branch`로 선택
6. `Branch`를 `main`으로 선택
7. 폴더는 `/root` 선택
8. `Save` 클릭

잠시 후 아래 형식의 GitHub Pages 주소가 생성됩니다.

```text
https://kijung4290.github.io/esign/
```

## 9. PUBLIC_SITE_URL 다시 확인

GitHub Pages 주소가 확정되면 Supabase Secret의 `PUBLIC_SITE_URL` 값을 실제 주소와 맞춥니다.

```text
PUBLIC_SITE_URL=https://kijung4290.github.io/esign
```

이 값은 관리자 화면에서 요청 링크를 생성할 때 사용됩니다.

## 10. 배포 테스트

1. GitHub Pages 주소 접속
2. 우측 상단 `관리자` 클릭
3. `ADMIN_PASSWORD`로 설정한 비밀번호 입력
4. `요청 링크` 탭에서 양식 선택
5. 수신자 이름과 만료일 입력
6. `요청 링크 생성` 클릭
7. 생성된 링크 복사
8. 새 브라우저 탭에서 링크 접속
9. 문서 작성 및 서명 제출
10. 관리자 화면의 `제출 문서`에서 제출 내역 확인
11. 검증번호로 `검증` 화면에서 이력 확인

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
- `service_role` 키와 DB 비밀번호는 절대 GitHub에 올리지 않습니다.
- DB 테이블은 RLS가 켜져 있으며 공개 정책을 만들지 않았습니다.
- 관리자 비밀번호는 GitHub 코드에 넣지 말고 Supabase Secret `ADMIN_PASSWORD`로만 설정합니다.
- 서명과 개인정보가 저장되므로 Supabase 계정 보안, 관리자 비밀번호 관리, 접근 권한 관리를 신중히 해야 합니다.

## 문제 해결

### `index.html`이 보이지 않는 경우

GitHub Pages 설정이 아래와 같은지 확인합니다.

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/root`

그리고 저장소 루트에 `index.html`이 있어야 합니다.

### API 설정 오류가 뜨는 경우

[src/config.js](./src/config.js)의 `API_URL`과 `ANON_KEY`를 확인합니다.

### 관리자 로그인이 안 되는 경우

Supabase Edge Function Secret의 `ADMIN_PASSWORD`가 맞는지 확인합니다.

### 요청 링크가 잘못된 주소로 생성되는 경우

Supabase Edge Function Secret의 `PUBLIC_SITE_URL`을 실제 GitHub Pages 주소로 수정합니다.

### DB 테이블이 없다는 오류가 나는 경우

Supabase SQL Editor에서 [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql) 내용을 다시 실행합니다.

