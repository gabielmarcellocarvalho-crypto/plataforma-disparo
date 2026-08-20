-- Foto de perfil do WhatsApp do contato (lead) — mostrada em Conversas e no CRM em vez de só
-- iniciais. Null = ainda não buscada, ou o contato não tem foto pública.
alter table contacts add column photo_url text;
