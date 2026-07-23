-- Configuração estruturada do agente (formulário: empresa, tom, horários, encaminhamento humano,
-- informações a coletar). O system_prompt continua sendo o texto final enviado à Anthropic —
-- gerado a partir desse config sempre que o formulário é salvo (ver src/lib/agent-prompt.ts).
alter table agents add column config jsonb not null default '{}'::jsonb;
