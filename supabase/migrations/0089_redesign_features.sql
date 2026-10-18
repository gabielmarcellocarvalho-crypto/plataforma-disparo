-- Funcionalidades do redesign. Só colunas NOVAS e opcionais (null por padrão): nenhum dado existente
-- muda, e quem não usa a funcionalidade não vê diferença.

-- Valor estimado do negócio (R$) — card do Pipeline, soma por coluna, "R$ em aberto".
alter table contacts add column if not exists deal_value numeric(14, 2);

-- Análise da conversa pela IA (gerada sob demanda pelo botão "Analisar com IA"): nota 0-100,
-- temperatura, resumo e próxima ação sugerida.
alter table contacts add column if not exists ai_score smallint check (ai_score between 0 and 100);
alter table contacts add column if not exists ai_temperature text check (ai_temperature in ('quente', 'morno', 'frio'));
alter table contacts add column if not exists ai_summary text;
alter table contacts add column if not exists ai_next_action text;
alter table contacts add column if not exists ai_scored_at timestamptz;

-- Entregue/lida das campanhas: o envio guarda o id da mensagem (wamid) e o webhook de status da Meta
-- marca quando foi entregue e lida.
alter table campaign_recipients add column if not exists external_id text;
alter table campaign_recipients add column if not exists delivered_at timestamptz;
alter table campaign_recipients add column if not exists read_at timestamptz;
create index if not exists idx_campaign_recipients_external on campaign_recipients (external_id) where external_id is not null;

-- Insights da IA da Visão geral (gerados sob demanda, no máximo 1 vez por hora por workspace).
alter table workspaces add column if not exists ai_insights jsonb;
alter table workspaces add column if not exists ai_insights_at timestamptz;
