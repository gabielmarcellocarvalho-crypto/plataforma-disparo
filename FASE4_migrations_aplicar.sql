-- Automações V1: 1 linha por (workspace, tipo de regra), não uma lista arbitrária — toggle+parâmetro
-- fixo por tipo (sem builder visual nesta rodada). Ausência de linha = regra desligada (default).
create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  type text not null check (type in ('deal_stale', 'contact_stale')),
  enabled boolean not null default false,
  days_threshold int not null default 3 check (days_threshold > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_automation_rules_workspace_type on automation_rules (workspace_id, type);

alter table automation_rules enable row level security;
create policy "acesso a automation_rules por workspace" on automation_rules
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Marca tarefas criadas automaticamente pelo cron de automações — usado pra checar "já existe tarefa
-- aberta dessa regra pra esse registro" antes de criar outra (evita duplicar a cada execução).
-- Aditivo/nullable, não afeta tarefas manuais (ficam com automation_rule_id null, como sempre foram).
alter table tasks add column automation_rule_id uuid references automation_rules (id) on delete set null;
create index idx_tasks_automation_rule on tasks (automation_rule_id) where automation_rule_id is not null;
