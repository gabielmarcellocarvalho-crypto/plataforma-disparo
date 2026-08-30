-- Observações internas sobre um negócio — mesmo padrão de contact_notes/company_notes.
create table deal_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  author_name text,
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_deal_notes_deal on deal_notes (deal_id, created_at desc);

alter table deal_notes enable row level security;
create policy "acesso a deal_notes por workspace" on deal_notes
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
