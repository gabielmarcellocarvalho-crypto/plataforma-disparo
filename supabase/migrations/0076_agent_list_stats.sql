-- Métricas por agente pra tela de Agentes (conversas hoje, leads atendidos, última atividade e tokens
-- pro custo estimado). Função agregada porque o PostgREST corta qualquer resposta em 1000 linhas: somar
-- mensagens no Node subestimava o custo de workspace grande (a Valec passa de 1000 mensagens num dia) e
-- puxar tudo paginado a cada abertura de tela seria dezenas de requisições (e de linhas de log).
--
-- `day_start` vem do app (meia-noite de Brasília) — o banco roda em UTC e "hoje" é o dia do cliente.
-- security invoker: respeita a RLS de messages, cada um só enxerga o próprio workspace.
create or replace function agent_list_stats(ws_id uuid, day_start timestamptz)
returns table (
  agent_id uuid,
  conversations_today bigint,
  leads_total bigint,
  last_activity timestamptz,
  input_tokens bigint,
  output_tokens bigint,
  cache_creation_input_tokens bigint,
  cache_read_input_tokens bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    m.agent_id,
    count(distinct m.contact_id) filter (where m.created_at >= day_start) as conversations_today,
    count(distinct m.contact_id) filter (where m.role = 'user') as leads_total,
    max(m.created_at) as last_activity,
    coalesce(sum(m.input_tokens), 0)::bigint,
    coalesce(sum(m.output_tokens), 0)::bigint,
    coalesce(sum(m.cache_creation_input_tokens), 0)::bigint,
    coalesce(sum(m.cache_read_input_tokens), 0)::bigint
  from messages m
  where m.workspace_id = ws_id
    and m.agent_id is not null
  group by m.agent_id;
$$;
