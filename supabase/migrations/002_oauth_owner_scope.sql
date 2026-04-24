create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  email text primary key,
  display_name text default '',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.templates add column if not exists owner_user_id uuid;
alter table public.templates add column if not exists owner_email text;

alter table public.signature_requests add column if not exists owner_user_id uuid;
alter table public.signature_requests add column if not exists owner_email text;

alter table public.submissions add column if not exists owner_user_id uuid;
alter table public.submissions add column if not exists owner_email text;

alter table public.audit_logs add column if not exists owner_user_id uuid;
alter table public.audit_logs add column if not exists owner_email text default '';

create or replace function public.is_allowed_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.admin_users admin_user
    where admin_user.is_active = true
      and lower(admin_user.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

alter table public.app_settings enable row level security;
alter table public.admin_users enable row level security;
alter table public.templates enable row level security;
alter table public.signature_requests enable row level security;
alter table public.submissions enable row level security;
alter table public.audit_logs enable row level security;

drop policy if exists templates_owner_select on public.templates;
drop policy if exists templates_owner_insert on public.templates;
drop policy if exists templates_owner_update on public.templates;
drop policy if exists templates_owner_delete on public.templates;
create policy templates_owner_select
  on public.templates
  for select
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy templates_owner_insert
  on public.templates
  for insert
  to authenticated
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy templates_owner_update
  on public.templates
  for update
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid())
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy templates_owner_delete
  on public.templates
  for delete
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());

drop policy if exists signature_requests_owner_select on public.signature_requests;
drop policy if exists signature_requests_owner_insert on public.signature_requests;
drop policy if exists signature_requests_owner_update on public.signature_requests;
drop policy if exists signature_requests_owner_delete on public.signature_requests;
create policy signature_requests_owner_select
  on public.signature_requests
  for select
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy signature_requests_owner_insert
  on public.signature_requests
  for insert
  to authenticated
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy signature_requests_owner_update
  on public.signature_requests
  for update
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid())
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy signature_requests_owner_delete
  on public.signature_requests
  for delete
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());

drop policy if exists submissions_owner_select on public.submissions;
drop policy if exists submissions_owner_insert on public.submissions;
drop policy if exists submissions_owner_update on public.submissions;
drop policy if exists submissions_owner_delete on public.submissions;
create policy submissions_owner_select
  on public.submissions
  for select
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy submissions_owner_insert
  on public.submissions
  for insert
  to authenticated
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy submissions_owner_update
  on public.submissions
  for update
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid())
  with check (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy submissions_owner_delete
  on public.submissions
  for delete
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());

drop policy if exists audit_logs_owner_select on public.audit_logs;
drop policy if exists audit_logs_owner_insert on public.audit_logs;
create policy audit_logs_owner_select
  on public.audit_logs
  for select
  to authenticated
  using (public.is_allowed_admin() and owner_user_id = auth.uid());
create policy audit_logs_owner_insert
  on public.audit_logs
  for insert
  to authenticated
  with check (
    public.is_allowed_admin()
    and (
      owner_user_id is null
      or owner_user_id = auth.uid()
    )
  );

create index if not exists admin_users_active_idx on public.admin_users(is_active);
create index if not exists templates_owner_user_idx on public.templates(owner_user_id);
create index if not exists signature_requests_owner_user_idx on public.signature_requests(owner_user_id);
create index if not exists submissions_owner_user_idx on public.submissions(owner_user_id);
create index if not exists audit_logs_owner_user_idx on public.audit_logs(owner_user_id);
