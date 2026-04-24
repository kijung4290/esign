# 전자서명 Supabase 버전

기존 전자서명 앱을 `GitHub Pages + Supabase`로 운영하는 버전입니다.

이번 구조에서는 관리자 비밀번호 대신 `Supabase OAuth 로그인`을 사용합니다.  
허용된 이메일로 로그인한 사용자만 관리자 화면에 들어갈 수 있고, 각 사용자가 만든 데이터는 해당 사용자만 읽을 수 있습니다.

## 핵심 변경점

- 로그인: Google OAuth
- 관리자 허용 기준: `public.admin_users` 테이블의 이메일
- 데이터 격리 기준: `owner_user_id`
- 격리 대상: 템플릿, 요청 링크, 제출 문서, 감사 로그
- 공개 접근 허용: 서명 링크 접속, 문서 검증번호 조회

즉, `a@example.com`이 만든 양식/요청/제출 문서는 `a@example.com` 본인만 관리자 화면에서 볼 수 있습니다.

## 폴더 구조

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
      002_oauth_owner_scope.sql
    functions/
      signature-api/
        index.ts
        deno.json
  README.md
```

## 처음 설치하는 경우

처음 설치라면 아래 순서대로 진행하면 됩니다.

1. Supabase 프로젝트 생성
2. DB 스키마 적용
3. Google OAuth 설정
4. 허용 사용자 이메일 등록
5. Edge Function 생성
6. Edge Function Secrets 등록
7. `src/config.js` 수정
8. GitHub Pages 배포
9. 로그인 테스트

아래에서 하나씩 설명합니다.

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에 로그인합니다.
2. `New project`를 클릭합니다.
3. 프로젝트 이름을 입력합니다.
4. 데이터베이스 비밀번호를 설정합니다.
5. Region을 선택합니다.
6. 프로젝트 생성이 끝날 때까지 기다립니다.

프로젝트가 만들어지면 아래 메뉴를 주로 사용합니다.

- `SQL Editor`
- `Authentication`
- `Edge Functions`
- `Project Settings > Data API` 또는 `Project Settings > API`
- `Project Settings > Edge Functions`

## 2. DB 스키마 적용

### 새로 설치하는 경우

1. Supabase에서 `SQL Editor`를 엽니다.
2. `New query`를 클릭합니다.
3. [supabase/migrations/001_initial_schema.sql](./supabase/migrations/001_initial_schema.sql) 파일 내용을 전체 복사합니다.
4. SQL Editor에 붙여넣고 `Run`을 누릅니다.

실행 후 아래 테이블이 생기면 정상입니다.

- `app_settings`
- `admin_users`
- `templates`
- `signature_requests`
- `submissions`
- `audit_logs`

### 예전 공개 버전에서 업그레이드하는 경우

예전에 이 프로젝트의 비밀번호 로그인 버전을 이미 설치했다면:

1. 먼저 기존 데이터를 백업합니다.
2. `001_initial_schema.sql`을 다시 실행하지 말고,
3. [supabase/migrations/002_oauth_owner_scope.sql](./supabase/migrations/002_oauth_owner_scope.sql) 파일만 실행합니다.

주의:

- 예전 공개 버전에서 만든 데이터에는 소유자 정보가 없을 수 있습니다.
- 그런 데이터는 새 구조에서 자동으로 사용자에게 연결되지 않습니다.
- 가장 안전한 방법은 `새 Supabase 프로젝트를 만드는 것`입니다.

## 3. Google OAuth 설정

이 앱은 `Google 로그인`을 기준으로 동작합니다.

### 3-1. Supabase URL 설정

1. Supabase에서 `Authentication`으로 이동합니다.
2. `URL Configuration`을 엽니다.
3. `Site URL`에 실제 사이트 주소를 넣습니다.

예시:

```text
https://kijung4290.github.io/esign
```

4. `Redirect URLs`에도 같은 주소를 추가합니다.
5. 로컬 테스트를 할 계획이면 아래도 추가합니다.

```text
http://localhost:5500/**
http://127.0.0.1:5500/**
```

참고:

- Supabase 공식 문서: https://supabase.com/docs/guides/auth/redirect-urls

### 3-2. Google Cloud에서 OAuth Client 만들기

1. https://console.cloud.google.com 에 로그인합니다.
2. 새 프로젝트를 만들거나 기존 프로젝트를 선택합니다.
3. `APIs & Services > OAuth consent screen`으로 이동합니다.
4. 앱 이름, 사용자 지원 이메일 등을 입력하고 저장합니다.
5. `APIs & Services > Credentials`로 이동합니다.
6. `Create Credentials > OAuth client ID`를 클릭합니다.
7. Application type은 `Web application`을 선택합니다.
8. 이름을 입력합니다.
9. `Authorized redirect URIs`에 Supabase가 안내하는 Google 콜백 URL을 넣습니다.

이 URL은 Supabase에서 아래 위치에서 확인할 수 있습니다.

1. `Authentication > Sign In / Providers > Google`
2. Google provider 설정 화면에 표시되는 Callback URL 복사

보통 형태는 아래와 같습니다.

```text
https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback
```

10. 저장 후 `Client ID`와 `Client Secret`을 복사합니다.

참고:

- Supabase 공식 문서: https://supabase.com/docs/guides/auth/social-login/auth-google

### 3-3. Supabase에 Google Provider 연결

1. Supabase에서 `Authentication > Sign In / Providers`로 이동합니다.
2. `Google`을 켭니다.
3. 방금 만든 `Client ID`, `Client Secret`을 입력합니다.
4. 저장합니다.

## 4. 허용 사용자 이메일 등록

이 단계가 중요합니다.

Google 로그인을 켜기만 하면 끝이 아닙니다.  
`admin_users` 테이블에 등록된 이메일만 관리자 화면에 들어갈 수 있습니다.

Supabase `SQL Editor`에서 아래처럼 실행하세요.

```sql
insert into public.admin_users (email, display_name)
values
  ('your-email@gmail.com', '관리자')
on conflict (email) do update
set
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();
```

여러 명을 허용하려면 여러 줄로 넣으면 됩니다.

```sql
insert into public.admin_users (email, display_name)
values
  ('a@example.com', '담당자 A'),
  ('b@example.com', '담당자 B')
on conflict (email) do update
set
  display_name = excluded.display_name,
  is_active = true,
  updated_at = now();
```

접근을 막고 싶으면:

```sql
update public.admin_users
set is_active = false, updated_at = now()
where email = 'a@example.com';
```

## 5. Edge Function 만들기

1. Supabase에서 `Edge Functions`로 이동합니다.
2. `Create a new function`을 클릭합니다.
3. 함수 이름을 `signature-api`로 만듭니다.
4. [supabase/functions/signature-api/index.ts](./supabase/functions/signature-api/index.ts) 파일 내용을 전체 복사합니다.
5. Supabase 편집기에 붙여넣고 배포합니다.

배포 후 Function URL은 보통 아래 형태입니다.

```text
https://YOUR_PROJECT_REF.supabase.co/functions/v1/signature-api
```

## 6. Edge Function Secrets 등록

1. Supabase에서 `Project Settings > Edge Functions`로 이동합니다.
2. `Secrets` 또는 `Environment variables`에서 아래 값을 추가합니다.

### 필수 값

```text
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
PUBLIC_SITE_URL=https://kijung4290.github.io/esign
```

설명:

- `SUPABASE_URL`: 프로젝트 URL
- `SUPABASE_SERVICE_ROLE_KEY`: service role key
- `PUBLIC_SITE_URL`: 실제 사용자 사이트 주소

중요:

- `service_role` 키는 브라우저에 넣지 않습니다.
- `service_role` 키는 Edge Function Secret에만 넣습니다.

## 7. API URL / anon key 확인

1. Supabase에서 `Project Settings > Data API` 또는 `Project Settings > API`로 이동합니다.
2. 아래 값을 복사합니다.

- `Project URL`
- `anon public key`

## 8. src/config.js 수정

[src/config.js](./src/config.js)를 열어서 아래 값을 본인 프로젝트 값으로 바꿉니다.

```js
window.ESIGN_CONFIG = {
  SUPABASE_URL: "https://YOUR_PROJECT_REF.supabase.co",
  API_URL: "https://YOUR_PROJECT_REF.supabase.co/functions/v1/signature-api",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  ANON_KEY: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  OAUTH_PROVIDER: "google"
};
```

설명:

- `SUPABASE_URL`: Supabase Auth 클라이언트용
- `API_URL`: Edge Function 주소
- `SUPABASE_ANON_KEY`: 브라우저에서 써도 되는 공개 키
- `OAUTH_PROVIDER`: 현재는 `google`

## 9. GitHub Pages 배포

이 저장소는 루트에 `index.html`이 있어서 GitHub Pages에서 바로 배포할 수 있습니다.

1. GitHub 저장소 페이지로 갑니다.
2. `Settings > Pages`로 이동합니다.
3. `Source`를 `Deploy from a branch`로 설정합니다.
4. Branch는 `main`
5. Folder는 `/root`
6. 저장합니다.

배포 주소 예시:

```text
https://kijung4290.github.io/esign/
```

`PUBLIC_SITE_URL`에는 보통 끝의 `/` 없이 아래처럼 넣는 편이 안전합니다.

```text
https://kijung4290.github.io/esign
```

## 10. 첫 로그인 테스트

1. GitHub Pages 주소로 접속합니다.
2. 상단 `관리자`를 클릭합니다.
3. `Google로 로그인` 버튼을 누릅니다.
4. `admin_users`에 넣어 둔 이메일 계정으로 로그인합니다.
5. 관리자 화면이 열리면 정상입니다.

정상 동작하면:

- 첫 로그인 시 기본 양식이 자동 생성됩니다.
- 요청 링크를 만들 수 있습니다.
- 내가 만든 요청/제출 문서만 보입니다.

## 데이터가 어떻게 분리되는가

각 주요 데이터에는 아래 값이 저장됩니다.

- `owner_user_id`
- `owner_email`

관리자 화면 조회 시 현재 로그인 사용자와 `owner_user_id`가 같은 데이터만 불러옵니다.

즉:

- A 사용자가 만든 템플릿은 A만 조회 가능
- A가 만든 요청 링크로 제출된 문서도 A만 조회 가능
- B 사용자는 같은 시스템을 써도 A 데이터를 읽을 수 없음

## 공개 접근이 가능한 것

아래 두 가지는 로그인 없이 동작합니다.

1. 요청 링크로 들어온 서명 페이지
2. 검증번호로 문서 이력 확인

대신 관리자 화면의 데이터 목록은 로그인 사용자 소유분만 보입니다.

## 자주 하는 실수

### 1. Google 로그인 후 다시 홈으로만 돌아오고 관리자 화면이 안 보임

가장 흔한 원인:

- `admin_users`에 이메일이 없음
- `URL Configuration`의 `Site URL` / `Redirect URLs`가 실제 배포 주소와 다름

먼저 아래를 확인하세요.

```sql
select * from public.admin_users;
```

### 2. Google 로그인 후 `localhost`로 되돌아감

원인:

- Supabase `URL Configuration`에 실제 배포 주소가 빠져 있음

공식 참고:

- https://supabase.com/docs/guides/auth/redirect-urls

### 3. Google OAuth 설정은 했는데 로그인 버튼이 오류남

확인할 것:

- Google Cloud의 OAuth Client가 `Web application`인지
- Google의 `Authorized redirect URI`에 Supabase callback URL이 정확히 들어갔는지
- Supabase Google provider에 같은 Client ID / Secret이 들어갔는지

### 4. 관리자 화면은 열리는데 양식이 안 보임

첫 로그인 직후에는 기본 양식이 자동 생성됩니다.  
그래도 안 보이면 Edge Function이 최신 코드인지 다시 배포해 보세요.

### 5. 기존 공개 버전 데이터가 안 보임

예전 비밀번호 로그인 버전 데이터는 소유자 정보가 없을 수 있습니다.  
이 버전은 `owner_user_id` 기준으로 데이터가 분리되므로, 기존 공개 데이터는 자동 연결되지 않을 수 있습니다.

가장 쉬운 방법:

- 새 Supabase 프로젝트를 만들어 001 스키마부터 다시 세팅

## 보안 메모

- 브라우저에는 `anon public key`만 넣습니다.
- `service_role` 키는 Edge Function Secret에만 넣습니다.
- 관리자 권한은 `admin_users` 이메일 허용 목록으로 제어합니다.
- DB 스키마에는 RLS 정책이 포함되어 있습니다.
- 관리자용 데이터는 `owner_user_id` 기준으로 분리됩니다.

## 참고 링크

- Supabase Auth 개요: https://supabase.com/docs/guides/auth
- Redirect URLs 설정: https://supabase.com/docs/guides/auth/redirect-urls
- Google 로그인 설정: https://supabase.com/docs/guides/auth/social-login/auth-google
