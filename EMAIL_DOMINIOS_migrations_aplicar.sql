create table if not exists email_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resend_domain_id text not null unique,
  domain_name text not null,
  status text not null default 'not_started',
  dns_records jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_email_domains_ws_domain
  on email_domains (workspace_id, domain_name);

alter table email_domains enable row level security;

drop policy if exists email_domains_ws on email_domains;

create policy email_domains_ws on email_domains
  for all using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));
