-- Tarefas/Atividades (CRM) — to-do com data de vencimento, vinculável a contato, empresa e/ou
-- negócio (as 3 FKs são opcionais e independentes, igual HubSpot: uma tarefa pode ser só "ligar pro
-- contato X" sem negócio nenhum, ou "follow-up do negócio Y" sem contato específico). Sem tabela de
-- notas própria — tarefa é simples o bastante pra não precisar de histórico de observações.
create table tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  title text not null,
  description text,
  due_at timestamptz,
  completed_at timestamptz,
  contact_id uuid references contacts (id) on delete set null,
  company_id uuid references companies (id) on delete set null,
  deal_id uuid references deals (id) on delete set null,
  responsible_user_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_tasks_workspace on tasks (workspace_id);
create index idx_tasks_due on tasks (workspace_id, due_at) where completed_at is null;
create index idx_tasks_contact on tasks (contact_id) where contact_id is not null;
create index idx_tasks_company on tasks (company_id) where company_id is not null;
create index idx_tasks_deal on tasks (deal_id) where deal_id is not null;
create index idx_tasks_responsible on tasks (responsible_user_id) where responsible_user_id is not null;

alter table tasks enable row level security;
create policy "acesso a tasks por workspace" on tasks
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
