-- Orçamento de custo de IA por workspace (colaborador define) + limite de alerta em %.
-- Alimenta o alerta "cliente passou de X% do custo previsto" na Visão geral e nas Métricas.
-- É o custo de IA (tokens Anthropic) do mês corrente comparado com esse teto — o custo que a gente
-- mede com precisão; canal (licença 360dialog + entrega Meta) é mais previsível e fica de fora daqui.
alter table workspaces add column monthly_cost_budget_brl numeric;
alter table workspaces add column cost_alert_pct integer not null default 80;
