-- Remove a feature "Negócios" (Deals) por completo — decisão do usuário: duplicava visualmente o
-- Pipeline (contacts.stage) sem ninguém usar de verdade (0 negócios em qualquer workspace ativo).
-- Ordem importa: trigger/função primeiro (referenciam deal_pipelines), depois as tabelas na ordem
-- inversa de dependência (deal_notes → deals → deal_stages → deal_pipelines).

drop trigger if exists on_workspace_created_deal_pipeline on workspaces;
drop function if exists handle_new_workspace_deal_pipeline();

-- tasks.deal_id fica órfão quando deals cai (era ON DELETE SET NULL, mas isso não remove a coluna) —
-- tira a coluna e o índice explicitamente.
drop index if exists idx_tasks_deal;
alter table tasks drop column if exists deal_id;

drop table if exists deal_notes;
drop table if exists deals;
drop table if exists deal_stages;
drop table if exists deal_pipelines;

-- automation_rules.type não aceita mais 'deal_stale' — remove qualquer linha existente do tipo antes
-- de apertar o check (nenhuma esperada, mas idempotente/seguro se algum workspace tiver criado).
delete from automation_rules where type = 'deal_stale';
alter table automation_rules drop constraint if exists automation_rules_type_check;
alter table automation_rules add constraint automation_rules_type_check check (type in ('contact_stale'));
