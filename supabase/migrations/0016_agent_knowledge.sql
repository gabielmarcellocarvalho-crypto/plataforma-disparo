-- Material de estudo do agente (PDF, planilha, texto) — NUNCA enviado ao cliente; vira um bloco
-- extra de contexto no prompt (também cacheado) pra ele responder com mais precisão sobre a empresa.
-- Diferente de agent_media, que é a biblioteca de arquivos que o agente manda pro cliente.
create table agent_knowledge (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  file_name text not null,
  content text not null,
  char_count integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_agent_knowledge_agent on agent_knowledge (agent_id);

alter table agent_knowledge enable row level security;
create policy "acesso a agent_knowledge por workspace" on agent_knowledge
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
