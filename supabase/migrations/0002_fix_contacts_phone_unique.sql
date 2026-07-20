-- Corrige o índice único de telefone: precisa ser um índice "cheio" (sem WHERE)
-- pra funcionar com ON CONFLICT / upsert na importação de contatos.
-- NULLs continuam permitidos em duplicidade (comportamento padrão do SQL: NULL != NULL).
drop index if exists idx_contacts_workspace_phone;
create unique index idx_contacts_workspace_phone on contacts (workspace_id, phone);
