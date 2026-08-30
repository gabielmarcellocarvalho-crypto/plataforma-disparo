-- Observações internas sobre uma empresa — mesmo padrão de contact_notes (0018): histórico, nunca
-- sobrescreve, só visível pra equipe.
create table company_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  author_name text,
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_company_notes_company on company_notes (company_id, created_at desc);

alter table company_notes enable row level security;
create policy "acesso a company_notes por workspace" on company_notes
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
