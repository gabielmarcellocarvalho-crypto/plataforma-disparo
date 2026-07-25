-- Quando o estágio mudou pela última vez — alimenta "há quantos dias está nessa fase" no Kanban.
alter table contacts add column stage_changed_at timestamptz not null default now();
