-- Consumo de IA fora das respostas do agente (análise de lead, insights, sugestão de resposta, teste
-- do agente). As respostas do agente continuam medidas em `messages`; isto aqui entra junto no custo de
-- IA de Métricas e no orçamento mensal do workspace.
create table if not exists ai_usage (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  feature text not null check (feature in ('analise_lead', 'insights', 'sugestao_resposta', 'teste_agente')),
  provider text not null check (provider in ('claude', 'gemini')),
  model text,
  agent_id uuid references agents (id) on delete set null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_creation_input_tokens int not null default 0,
  cache_read_input_tokens int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_usage_workspace_created on ai_usage (workspace_id, created_at);

-- Leitura pela equipe do workspace (Métricas). A gravação é feita só pelo servidor (service role).
alter table ai_usage enable row level security;
create policy "leitura de consumo de ia por workspace" on ai_usage for select using (has_workspace_access(workspace_id));
