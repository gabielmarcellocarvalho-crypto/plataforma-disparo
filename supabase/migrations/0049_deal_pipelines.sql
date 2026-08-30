-- Pipeline de negócios (Deals) — conceito de estágio totalmente separado de contacts.stage. Fase 1
-- cria 1 pipeline "Padrão" por workspace; o schema já comporta múltiplos pipelines no futuro sem
-- precisar de migration nova.
create table deal_pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null default 'Padrão',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_deal_pipelines_workspace on deal_pipelines (workspace_id);
create unique index idx_deal_pipelines_one_default on deal_pipelines (workspace_id) where is_default;

alter table deal_pipelines enable row level security;
create policy "acesso a deal_pipelines por workspace" on deal_pipelines
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
