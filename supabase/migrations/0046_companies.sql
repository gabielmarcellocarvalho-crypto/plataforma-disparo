-- Empresas (CRM) — objeto novo, independente do funil de contacts.stage (que continua servindo só
-- a classificação de atendimento). Uma empresa agrupa contatos e negócios, no modelo padrão de CRM
-- (contato = pessoa, empresa = organização à qual ela pode pertencer).
create table companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  domain text, -- normalizado (lowercase, sem protocolo/www) no Server Action, pra dedupe por domínio
  website text, -- url livre, exibição
  phone text,
  industry text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_companies_workspace on companies (workspace_id);
create index idx_companies_workspace_name on companies (workspace_id, lower(name));
create unique index idx_companies_workspace_domain on companies (workspace_id, lower(domain)) where domain is not null;

alter table companies enable row level security;
create policy "acesso a companies por workspace" on companies
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
