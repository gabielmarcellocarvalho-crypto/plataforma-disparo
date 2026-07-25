-- Estágio do contato no funil (CRM/Kanban) — um campo só, unificado pra qualquer canal (conversa
-- com agente de IA, disparo em massa no WhatsApp sem IA, ou campanha de e-mail via Resend), já que
-- contacts já é uma tabela compartilhada entre todos eles.
alter table contacts add column stage text not null default 'nao_abordado'
  check (stage in ('nao_abordado', 'abordado', 'interessado', 'encaminhamento', 'fechando_proposta', 'concluido', 'descartado'));
create index idx_contacts_stage on contacts (workspace_id, stage);
