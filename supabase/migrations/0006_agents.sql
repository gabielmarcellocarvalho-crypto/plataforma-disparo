-- Agentes de IA: cada agente é um número de WhatsApp próprio (própria instância Evolution)
-- dentro de um workspace, com prompt próprio. Coexiste com whatsapp_instances (número de
-- disparo em massa sem IA) — são conceitos diferentes dentro do mesmo workspace.
create table agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  system_prompt text not null default '',
  evolution_instance_name text not null unique,
  phone_number text,
  connection_status text not null default 'desconectado',
  status text not null default 'ativo' check (status in ('ativo', 'pausado')),
  created_at timestamptz not null default now()
);
create index idx_agents_workspace on agents (workspace_id);

alter table agents enable row level security;
create policy "acesso a agentes por workspace" on agents
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- Histórico de conversa por agente (mensagens de blast continuam com agent_id nulo).
alter table messages add column agent_id uuid references agents (id) on delete cascade;
create index idx_messages_agent on messages (agent_id, contact_id);

-- Contato "precisa de atenção humana": agente parou de responder automaticamente até alguém revisar.
alter table contacts add column needs_attention boolean not null default false;
alter table contacts add column attention_reason text;
