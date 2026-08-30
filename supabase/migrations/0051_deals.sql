-- Negócios (Deals) — oportunidade de venda com valor $, separada do estado de atendimento do
-- contato (contacts.stage). Pode estar ligado a uma empresa, a um contato direto, aos dois, ou (no
-- formulário de criação rápida) a nenhum ainda.
create table deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  pipeline_id uuid not null references deal_pipelines (id) on delete cascade,
  stage_id uuid not null references deal_stages (id) on delete restrict, -- restrict: força mover os deals antes de apagar um estágio
  name text not null,
  company_id uuid references companies (id) on delete set null,
  contact_id uuid references contacts (id) on delete set null,
  amount numeric(14, 2),
  close_date date,
  responsible_user_id uuid references profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  custom_fields jsonb not null default '{}'::jsonb,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_deals_workspace on deals (workspace_id);
create index idx_deals_pipeline_stage on deals (pipeline_id, stage_id);
create index idx_deals_company on deals (company_id) where company_id is not null;
create index idx_deals_contact on deals (contact_id) where contact_id is not null;
create index idx_deals_responsible on deals (responsible_user_id) where responsible_user_id is not null;

alter table deals enable row level security;
create policy "acesso a deals por workspace" on deals
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
