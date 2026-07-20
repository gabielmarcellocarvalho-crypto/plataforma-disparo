-- Domínios de e-mail por workspace (gerenciados via API do Resend, sem sair da plataforma).
create table email_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resend_domain_id text not null unique,
  domain_name text not null,
  from_email text,
  status text not null default 'not_started', -- not_started | pending | verified | failed
  dns_records jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create unique index idx_email_domains_workspace_domain on email_domains (workspace_id, domain_name);

alter table email_domains enable row level security;

create policy "acesso a dominios de email por workspace" on email_domains
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
