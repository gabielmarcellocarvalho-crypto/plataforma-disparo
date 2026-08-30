-- Estágios de um pipeline de negócios — nome/ordem/cor livres por workspace (diferente das 7 fases
-- fixas de contacts.stage). is_won/is_lost marcam os estágios terminais, usados por updateDealStage
-- pra setar deals.status automaticamente ao mover um card pra lá.
create table deal_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references deal_pipelines (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade, -- denormalizado: RLS/índice simples sem join
  name text not null,
  position int not null,
  color text,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_deal_stages_pipeline on deal_stages (pipeline_id, position);
create index idx_deal_stages_workspace on deal_stages (workspace_id);

alter table deal_stages enable row level security;
create policy "acesso a deal_stages por workspace" on deal_stages
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
