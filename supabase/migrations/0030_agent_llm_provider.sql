-- Permite escolher o provedor de IA por agente (Claude ou Gemini), pra pilotar custo/qualidade
-- num agente de teste sem afetar os demais. Default 'claude' preserva o comportamento de todos os
-- agentes já existentes.
alter table agents add column llm_provider text not null default 'claude' check (llm_provider in ('claude', 'gemini'));
