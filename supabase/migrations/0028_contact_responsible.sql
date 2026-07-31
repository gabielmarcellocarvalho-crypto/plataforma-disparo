-- Responsável (vendedor humano do próprio cliente) por um lead — só relevante em planos com SDR
-- (o SDR qualifica e passa a bola pra um vendedor; Closer puro fecha sozinho, sem handoff humano).
-- Aponta pra um profile que tem login vinculado a esse mesmo workspace (não precisa ser um cargo
-- separado — qualquer pessoa com acesso de cliente daquele workspace pode ser atribuída).
alter table contacts add column responsible_user_id uuid references profiles (id) on delete set null;
create index idx_contacts_responsible on contacts (responsible_user_id) where responsible_user_id is not null;
