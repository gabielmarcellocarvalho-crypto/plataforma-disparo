-- Marca tarefas criadas automaticamente pelo cron de automações — usado pra checar "já existe tarefa
-- aberta dessa regra pra esse registro" antes de criar outra (evita duplicar a cada execução).
-- Aditivo/nullable, não afeta tarefas manuais (ficam com automation_rule_id null, como sempre foram).
alter table tasks add column automation_rule_id uuid references automation_rules (id) on delete set null;
create index idx_tasks_automation_rule on tasks (automation_rule_id) where automation_rule_id is not null;
