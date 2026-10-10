-- Visão geral calculada no banco. Antes, cada indicador puxava milhares de linhas para o servidor
-- (mensagens inteiras, contatos inteiros, em páginas de 1000 uma depois da outra) e somava em memória.
-- Aqui o Postgres soma e devolve só o resultado. O app tenta estas funções e, se elas não existirem
-- ou falharem, cai no cálculo antigo — então rodar esta migration não é pré-requisito pra nada quebrar.
--
-- Todas são `security invoker`: rodam com a permissão de quem chamou, então a RLS de contacts/messages
-- continua valendo (um usuário só enxerga o workspace dele).
-- Idempotente: pode rodar de novo.

-- Índices que faltavam. Toda consulta por período (Conversas, Pipeline, Visão geral) filtra por
-- workspace_id + created_at, e hoje só existia índice em workspace_id sozinho.
create index if not exists idx_messages_workspace_created on messages (workspace_id, created_at desc);
create index if not exists idx_contacts_workspace_created on contacts (workspace_id, created_at desc);

-- Volume: leads recebidos, mensagens, leads abordados, conversas iniciadas e em andamento.
create or replace function overview_volume(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with pairs as (
    -- Uma "conversa" = par contato + agente (agente nulo = disparo sem agente), igual ao cálculo antigo.
    select contact_id, agent_id, min(created_at) as first_at, bool_or(created_at >= p_from) as active
    from messages
    where workspace_id = p_workspace and created_at <= p_to
    group by contact_id, agent_id
  )
  select jsonb_build_object(
    'leads_recebidos', (select count(*) from contacts where workspace_id = p_workspace and created_at between p_from and p_to),
    'mensagens_enviadas', (select count(*) from messages where workspace_id = p_workspace and role = 'assistant' and created_at between p_from and p_to),
    'mensagens_recebidas', (select count(*) from messages where workspace_id = p_workspace and role = 'user' and created_at between p_from and p_to),
    'leads_abordados', (select count(distinct contact_id) from messages where workspace_id = p_workspace and role = 'assistant' and created_at between p_from and p_to),
    'conversas_iniciadas', (select count(*) from pairs where first_at between p_from and p_to),
    'conversas_em_andamento', (
      select count(*) from pairs p
      join contacts c on c.id = p.contact_id and c.workspace_id = p_workspace
      where p.active and c.stage not in ('concluido', 'descartado')
    )
  );
$$;

-- Tempo de resposta e conversas esperando resposta, dentro do período.
-- Devolve somas, não médias: o app aplica o mesmo arredondamento de sempre.
create or replace function overview_response(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with m as (
    select id, contact_id, agent_id, role, created_at,
           -- quantas respostas nossas vieram ANTES desta linha, dentro da mesma conversa
           count(*) filter (where role = 'assistant') over (
             partition by contact_id, agent_id order by created_at, id
             rows between unbounded preceding and 1 preceding
           ) as a_before
    from messages
    where workspace_id = p_workspace and created_at between p_from and p_to
  ),
  first_user as (
    -- primeira mensagem do cliente que ficou esperando, antes de cada resposta nossa
    select contact_id, agent_id, a_before as g, min(created_at) as t
    from m where role = 'user'
    group by contact_id, agent_id, a_before
  ),
  lat as (
    select extract(epoch from (a.created_at - u.t)) * 1000 as ms
    from m a
    join first_user u on u.contact_id = a.contact_id and u.agent_id is not distinct from a.agent_id and u.g = a.a_before
    where a.role = 'assistant'
  ),
  last_msg as (
    select distinct on (contact_id, agent_id) contact_id, agent_id, role, created_at
    from m
    order by contact_id, agent_id, created_at desc, id desc
  )
  select jsonb_build_object(
    'lat_sum_ms', (select coalesce(sum(ms), 0) from lat),
    'lat_count', (select count(*) from lat),
    'unanswered', (select count(*) from last_msg where role = 'assistant'),
    'oldest_unanswered_at', (select min(created_at) from last_msg where role = 'assistant')
  );
$$;

-- Base das taxas de conversão: quantos foram abordados, quantos responderam e em que fase estão hoje.
create or replace function overview_conversion(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with ab as (
    select distinct contact_id from messages
    where workspace_id = p_workspace and role = 'assistant' and created_at between p_from and p_to
  ),
  re as (
    select distinct contact_id from messages
    where workspace_id = p_workspace and role = 'user' and created_at between p_from and p_to
  ),
  st as (
    select c.stage from ab join contacts c on c.id = ab.contact_id and c.workspace_id = p_workspace
  )
  select jsonb_build_object(
    'abordados', (select count(*) from ab),
    'responderam', (select count(*) from ab join re using (contact_id)),
    'interessados', (select count(*) from st where stage in ('interessado', 'encaminhamento', 'fechando_proposta', 'concluido')),
    'qualificados', (select count(*) from st where stage in ('encaminhamento', 'fechando_proposta', 'concluido')),
    'fechados', (select count(*) from st where stage = 'concluido')
  );
$$;

-- Funil: leads criados no período, contados por fase atual.
create or replace function overview_funnel(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb)
  from (
    select stage, count(*) as n from contacts
    where workspace_id = p_workspace and created_at between p_from and p_to
    group by stage
  ) t;
$$;

-- Origem dos leads recebidos no período (custom_fields.origem; sem origem = "WhatsApp direto").
create or replace function overview_lead_sources(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'value', n) order by n desc, first_at asc), '[]'::jsonb)
  from (
    select label, count(*) as n, min(created_at) as first_at
    from (
      select created_at,
             case when jsonb_typeof(custom_fields -> 'origem') = 'string' and btrim(custom_fields ->> 'origem', E' \t\r\n') <> ''
                  then btrim(custom_fields ->> 'origem', E' \t\r\n')
                  else 'WhatsApp direto' end as label
      from contacts
      where workspace_id = p_workspace and created_at between p_from and p_to
    ) x
    group by label
  ) y;
$$;

-- Mensagens enviadas por dia (fuso de Brasília), pro gráfico.
create or replace function overview_messages_by_day(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_object_agg(d, n), '{}'::jsonb)
  from (
    select to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as d, count(*) as n
    from messages
    where workspace_id = p_workspace and role = 'assistant' and created_at between p_from and p_to
    group by 1
  ) t;
$$;
