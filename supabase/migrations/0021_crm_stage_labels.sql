-- Rótulos personalizados por workspace pros 7 estágios do funil. O SINAL que o agente classifica
-- (chave interna: nao_abordado, abordado, interessado, encaminhamento, fechando_proposta, concluido,
-- descartado) continua fixo — só o texto exibido no Kanban muda por cliente (ex.: "concluido" pode
-- aparecer como "Fechado" pra um cliente de vendas ou "Passou pro vendedor" pra um de recepção).
alter table workspaces add column crm_stage_labels jsonb not null default '{}'::jsonb;
