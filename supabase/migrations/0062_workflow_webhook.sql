-- Workflows Fase 3 (pedido do usuário 2026-09-01): gatilho por webhook externo, ação "chamar
-- webhook (HTTP)" e variáveis extras — sem mudança de schema pras variáveis (só lib) nem pra
-- ação HTTP (config genérico já cabe no jsonb existente de workflow_steps.config).

alter table workflows drop constraint if exists workflows_trigger_type_check;
alter table workflows add constraint workflows_trigger_type_check check (trigger_type in ('stage_enter', 'stage_stale', 'no_reply', 'webhook'));

-- Token opaco e único usado na URL pública /api/workflows/webhook/[token] — funciona como a própria
-- autenticação (padrão comum de webhook: segredo na URL, sem header extra). Só workflows do tipo
-- 'webhook' têm token; os outros ficam null.
alter table workflows add column webhook_token text unique;
