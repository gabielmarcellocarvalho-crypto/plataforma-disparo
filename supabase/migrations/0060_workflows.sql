-- Workflows (Fase 1, pedido do usuário 2026-08-31): motor de automação linear — gatilho + público +
-- passos (esperar/ação) em sequência, sem ramificação SIM/NÃO ainda (isso fica pra Fase 2).
-- workspace_id é denormalizado em TODAS as tabelas (mesmo padrão de `tasks`) pra RLS e queries
-- simples, sem precisar de join até `workflows` toda vez.

create table workflows (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  description text,
  enabled boolean not null default true,
  trigger_type text not null check (trigger_type in ('stage_enter', 'stage_stale', 'no_reply')),
  trigger_config jsonb not null default '{}'::jsonb,
  audience_config jsonb not null default '{}'::jsonb,
  stop_on_reply boolean not null default true,
  stop_on_stage_change boolean not null default false,
  respect_business_hours boolean not null default true,
  allow_reentry boolean not null default false,
  created_by uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_workflows_workspace on workflows (workspace_id);

create table workflow_steps (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  position int not null,
  step_type text not null check (step_type in ('wait', 'action')),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workflow_id, position)
);
create index idx_workflow_steps_workflow on workflow_steps (workflow_id);

-- 1 execução ativa por (workflow, contato) — impede duplicar o mesmo lead na mesma automação
-- enquanto ela ainda está rodando/esperando. Índice parcial (não unique constraint direto) porque
-- reentrada (allow_reentry) precisa permitir uma NOVA linha depois que a anterior completar/parar.
create table workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references workflows (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'waiting', 'completed', 'stopped', 'error')),
  current_step_index int not null default 0,
  next_run_at timestamptz not null default now(),
  stop_reason text,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index idx_workflow_runs_due on workflow_runs (workflow_id, status, next_run_at);
create index idx_workflow_runs_contact on workflow_runs (contact_id);
create unique index idx_workflow_runs_active_unique on workflow_runs (workflow_id, contact_id) where status in ('running', 'waiting');

create table workflow_run_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references workflow_runs (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  step_index int,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index idx_workflow_run_events_run on workflow_run_events (run_id, created_at);

alter table workflows enable row level security;
alter table workflow_steps enable row level security;
alter table workflow_runs enable row level security;
alter table workflow_run_events enable row level security;

create policy "acesso a workflows por workspace" on workflows
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
create policy "acesso a workflow_steps por workspace" on workflow_steps
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
create policy "acesso a workflow_runs por workspace" on workflow_runs
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
create policy "acesso a workflow_run_events por workspace" on workflow_run_events
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
