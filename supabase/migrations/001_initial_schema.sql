create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  description text default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.templates (
  id text primary key,
  name text not null,
  description text default '',
  category text default '일반 문서',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.signature_requests (
  id uuid primary key default gen_random_uuid(),
  token uuid not null unique default gen_random_uuid(),
  template_id text not null references public.templates(id),
  template_name text not null,
  recipient_name text default '',
  status text not null default 'SENT' check (status in ('SENT', 'VIEWED', 'COMPLETED', 'EXPIRED')),
  requested_at timestamptz not null default now(),
  opened_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz not null,
  last_accessed_at timestamptz,
  access_count integer not null default 0,
  request_message text default '',
  created_by text default ''
);

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  request_token uuid references public.signature_requests(token),
  template_id text not null,
  template_name text not null,
  signer_name text default '',
  signer_email text default '',
  form_data jsonb not null default '{}'::jsonb,
  signatures jsonb not null default '{}'::jsonb,
  field_summary jsonb not null default '[]'::jsonb,
  mode text not null default 'direct',
  completed_at timestamptz not null default now(),
  template_content_snapshot text not null,
  verification_code text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_token uuid,
  event_type text not null,
  actor_name text default '',
  actor_email text default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.admin_sessions (
  token uuid primary key default gen_random_uuid(),
  actor text default 'admin',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;
alter table public.templates enable row level security;
alter table public.signature_requests enable row level security;
alter table public.submissions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.admin_sessions enable row level security;

create index if not exists signature_requests_token_idx on public.signature_requests(token);
create index if not exists signature_requests_status_idx on public.signature_requests(status);
create index if not exists submissions_request_token_idx on public.submissions(request_token);
create index if not exists submissions_verification_code_idx on public.submissions(verification_code);
create index if not exists audit_logs_request_token_idx on public.audit_logs(request_token);

insert into public.app_settings (key, value, description)
values
  (
    'PrivacyPolicy',
    '본인은 전자문서 작성과 서명 처리를 위해 필요한 개인정보 수집 및 이용에 동의합니다. 수집 항목은 성명, 연락처, 서명 이미지, 문서 입력값이며 보유 기간은 기관 내부 기준에 따릅니다.',
    '서명 전 안내할 개인정보 수집 및 이용 문구'
  )
on conflict (key) do nothing;

insert into public.templates (id, name, description, category, content)
values
  (
    'T001',
    '강사 계약서',
    '강사명, 강의 주제, 일정, 서명을 받는 기본 계약 양식입니다.',
    '계약',
    '<section class="doc-heading"><p>CONTRACT</p><h1>강사 계약서</h1></section>
<p>아래와 같이 강사 활동과 관련한 내용을 확인하고 계약을 체결합니다.</p>
<table class="doc-table">
  <tr><th>강사명</th><td>[[text:강사명|required|placeholder=강사명을 입력하세요]]</td></tr>
  <tr><th>강의 주제</th><td>[[text:강의주제|required|placeholder=강의 주제를 입력하세요]]</td></tr>
  <tr><th>진행 일시</th><td>[[text:진행일시|required|placeholder=예: 2026.05.15 14:00]]</td></tr>
  <tr><th>특이 사항</th><td>[[text:특이사항|optional|placeholder=없으면 비워두세요|size=wide]]</td></tr>
</table>
<h2>최종 확인</h2>
<p>본인은 위 내용을 확인했으며 전자서명 제출에 동의합니다.</p>
<p>[[check:계약내용확인|required|label=계약 내용을 모두 확인했습니다.]]</p>
<p>강사 서명: [[sign:강사서명|required|role=강사]]</p>'
  ),
  (
    'T002',
    '강의 확인서',
    '강의 완료 여부를 확인하는 제출 양식입니다.',
    '확인',
    '<section class="doc-heading"><p>CONFIRMATION</p><h1>강의 확인서</h1></section>
<table class="doc-table">
  <tr><th>강사명</th><td>[[text:강사명|required|placeholder=강사명]]</td></tr>
  <tr><th>강의명</th><td>[[text:강의명|required|placeholder=강의명]]</td></tr>
  <tr><th>강의일</th><td>[[date:강의일|required]]</td></tr>
  <tr><th>확인자</th><td>[[text:확인자|required|placeholder=확인자 성명]]</td></tr>
</table>
<p>[[check:강의완료확인|required|label=강의가 정상적으로 완료되었음을 확인합니다.]]</p>
<p>확인 서명: [[sign:확인서명|required|role=확인자]]</p>'
  ),
  (
    'T003',
    '프로그램 참여 신청서',
    '프로그램 참여자 기본 정보와 동의를 받는 신청 양식입니다.',
    '신청',
    '<section class="doc-heading"><p>APPLICATION</p><h1>프로그램 참여 신청서</h1></section>
<table class="doc-table">
  <tr><th>프로그램명</th><td>[[text:프로그램명|required|placeholder=프로그램명]]</td></tr>
  <tr><th>참여자 성명</th><td>[[text:참여자성명|required|placeholder=성명]]</td></tr>
  <tr><th>생년월일</th><td>[[text:생년월일|required|placeholder=예: 1970-01-01]]</td></tr>
  <tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr>
  <tr><th>주소</th><td>[[text:주소|optional|placeholder=주소|size=wide]]</td></tr>
</table>
<p>[[check:참여동의|required|label=프로그램 운영 안내와 유의사항을 확인했습니다.]]</p>
<p>참여자 서명: [[sign:참여자서명|required|role=참여자]]</p>'
  ),
  (
    'T004',
    '개인정보 수집 이용 및 초상권 동의서',
    '개인정보 수집, 이용, 사진 촬영 및 활용 동의 양식입니다.',
    '동의',
    '<section class="doc-heading"><p>CONSENT</p><h1>개인정보 수집 이용 및 초상권 동의서</h1></section>
<p>기관은 서비스 제공, 참여자 관리, 사업 기록을 위해 아래 항목을 수집 및 이용합니다.</p>
<table class="doc-table">
  <tr><th>성명</th><td>[[text:성명|required|placeholder=성명]]</td></tr>
  <tr><th>생년월일</th><td>[[text:생년월일|required|placeholder=예: 1970-01-01]]</td></tr>
  <tr><th>연락처</th><td>[[text:연락처|required|placeholder=010-0000-0000]]</td></tr>
</table>
<p>[[check:개인정보동의|required|label=개인정보 수집 및 이용에 동의합니다.]]</p>
<p>[[check:사진영상동의|optional|label=프로그램 사진 및 영상 기록 활용에 동의합니다.]]</p>
<p>본인 서명: [[sign:본인서명|required|role=본인]]</p>'
  )
on conflict (id) do nothing;
