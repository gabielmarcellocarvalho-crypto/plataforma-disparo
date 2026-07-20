-- Campanha de WhatsApp pode ser disparada por um agente de IA em vez de mensagem fixa —
-- nesse caso agent_id aponta pro agente que manda a abertura e assume a conversa depois.
alter table campaigns add column agent_id uuid references agents (id) on delete set null;
