-- Agenda do vendedor: o agente cria tarefas na /agenda quando o lead chega numa fase configurada.
-- Aditivo: colunas novas nullable, nenhuma linha existente muda.

-- Vendedor é team_members (sem login); responsible_user_id continua sendo a conta que opera a plataforma.
alter table tasks add column if not exists team_member_id uuid references team_members (id) on delete set null;
alter table tasks add column if not exists agent_id uuid references agents (id) on delete set null;
-- 'manual' = criada por gente; 'agente' = criada pelo agente ao lead chegar na fase.
alter table tasks add column if not exists source text not null default 'manual' check (source in ('manual', 'agente'));
-- Resumo da conversa no momento da passagem.
alter table tasks add column if not exists conversation_summary text;

create index if not exists idx_tasks_team_member on tasks (team_member_id) where team_member_id is not null;

-- Um lead gera no máximo uma tarefa do agente por agente: o agente reclassifica a cada mensagem e
-- o gatilho (>= fase) dispara de novo; o índice faz a segunda tentativa virar no-op.
create unique index if not exists uq_tasks_agent_contact on tasks (contact_id, agent_id) where source = 'agente';
