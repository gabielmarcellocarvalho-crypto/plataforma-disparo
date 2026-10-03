-- Leads de formulário de anúncio do Facebook (spec em conversa, 2026-10-03).
-- Idempotente: pode rodar de novo.

-- Uma autorização de um usuário do Facebook por workspace.
create table if not exists facebook_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  fb_user_id text not null,
  fb_user_name text,
  status text not null default 'conectado',
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, fb_user_id)
);

-- Páginas autorizadas. O token da página fica CIFRADO e sem policy de leitura: só o servidor usa.
create table if not exists facebook_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  connection_id uuid not null references facebook_connections (id) on delete cascade,
  page_id text not null,
  page_name text,
  page_token_enc text not null,
  status text not null default 'ativa',
  created_at timestamptz not null default now(),
  unique (workspace_id, page_id)
);
create index if not exists idx_facebook_pages_page on facebook_pages (page_id);

-- Formulários de lead escolhidos pra chegar na plataforma, com a etiqueta que eles recebem.
create table if not exists facebook_lead_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  page_id text not null,
  form_id text not null,
  form_name text,
  enabled boolean not null default false,
  tag text,
  updated_at timestamptz not null default now(),
  unique (workspace_id, form_id)
);

-- Cada lead recebido (dedupe: o Facebook pode mandar o mesmo aviso mais de uma vez).
create table if not exists facebook_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  leadgen_id text not null,
  form_id text,
  contact_id uuid references contacts (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (workspace_id, leadgen_id)
);

alter table facebook_connections enable row level security;
alter table facebook_pages enable row level security;
alter table facebook_lead_forms enable row level security;
alter table facebook_leads enable row level security;

drop policy if exists "leitura facebook_connections" on facebook_connections;
create policy "leitura facebook_connections" on facebook_connections for select using (has_workspace_access(workspace_id));

drop policy if exists "leitura facebook_lead_forms" on facebook_lead_forms;
create policy "leitura facebook_lead_forms" on facebook_lead_forms for select using (has_workspace_access(workspace_id));

drop policy if exists "leitura facebook_leads" on facebook_leads;
create policy "leitura facebook_leads" on facebook_leads for select using (has_workspace_access(workspace_id));
