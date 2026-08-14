-- Prepara o workspace pra ter mais de um número de disparo (ex.: Vendas + Financeiro) dentro do
-- MESMO workspace/login, cada um com seu próprio contexto de contatos. Hoje (lançamento) só existe
-- 1 instância por workspace na prática (o fluxo de conexão em src/app/actions/whatsapp.ts ainda gera
-- um nome determinístico por workspace_id, não suporta criar uma segunda) — isso fica pra quando o
-- número do financeiro entrar, mas o campo já existe pronto pra não precisar de migração depois.
alter table whatsapp_instances add column department text not null default 'vendas';

-- Contato "pertence" a um número específico (nulo = contato de agente de IA, ou workspace com só
-- 1 número — não precisa de contexto). Usado pelo seletor Vendas/Financeiro em Conversas e CRM,
-- que só aparece quando o workspace tem mais de 1 whatsapp_instances (senão, comportamento igual a hoje).
alter table contacts add column whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null;
create index idx_contacts_whatsapp_instance on contacts (whatsapp_instance_id);
