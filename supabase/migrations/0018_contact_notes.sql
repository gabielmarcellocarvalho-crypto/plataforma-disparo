-- Observações internas que o time deixa num lead (histórico, não um campo único sobrescrevível).
-- Nunca vai pro cliente — é só anotação de equipe, visível no painel de detalhe do CRM.
create table contact_notes (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  author_name text,
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_contact_notes_contact on contact_notes (contact_id, created_at desc);

alter table contact_notes enable row level security;
create policy "acesso a contact_notes por workspace" on contact_notes
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
