-- Marca mensagens de agente que são follow-up automático (retomada por silêncio do contato, não
-- resposta a algo que ele disse) — o worker de cron usa isso pra contar quantos follow-ups já foram
-- tentados numa janela de silêncio e decidir quando parar (ver AgentConfig.followUp em agent-prompt.ts).
alter table messages add column is_followup boolean not null default false;
