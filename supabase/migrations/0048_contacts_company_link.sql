-- Vínculo opcional contato → empresa primária. Aditivo e nullable — não mexe em contacts.stage nem
-- em nenhuma lógica de classificação de agente, cron ou webhook existente.
alter table contacts add column company_id uuid references companies (id) on delete set null;
create index idx_contacts_company on contacts (company_id) where company_id is not null;
