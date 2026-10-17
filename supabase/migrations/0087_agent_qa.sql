-- Perguntas do agente para a equipe + perguntas frequentes (FAQ), por agente.
-- Quando o agente não sabe responder, ele registra a pergunta aqui (status 'pendente', source 'agente');
-- a equipe responde na tela de Agentes e a resposta vira memória dele ('respondida'). A equipe também
-- pode cadastrar perguntas frequentes direto (source 'manual', já 'respondida').
-- Só adiciona uma tabela nova; idempotente (pode rodar de novo). O app trata a tabela ausente como
-- "recurso desligado", então rodar esta migration não é pré-requisito pra nada quebrar.
create table if not exists agent_qa (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  agent_id uuid not null references agents (id) on delete cascade,
  contact_id uuid references contacts (id) on delete set null,
  question text not null,
  answer text,
  status text not null default 'pendente' check (status in ('pendente', 'respondida', 'descartada')),
  source text not null default 'agente' check (source in ('agente', 'manual')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  answered_by uuid
);
create index if not exists idx_agent_qa_agent_status on agent_qa (agent_id, status);
create index if not exists idx_agent_qa_workspace on agent_qa (workspace_id, created_at desc);

alter table agent_qa enable row level security;
drop policy if exists "acesso a agent_qa por workspace" on agent_qa;
create policy "acesso a agent_qa por workspace" on agent_qa
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
