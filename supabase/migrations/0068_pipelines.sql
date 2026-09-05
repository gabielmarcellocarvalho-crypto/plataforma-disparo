-- Múltiplos funis por workspace, com etapas próprias.
--
-- DESENHO CENTRAL, e o motivo de isso não quebrar o resto: `contacts.stage` (os 7 sinais internos
-- fixos) CONTINUA sendo a verdade semântica que o agente de IA classifica, que as métricas somam,
-- que o funil da Visão geral desenha e que os workflows filtram. O funil personalizado é uma camada
-- de VOCABULÁRIO e ORDENAÇÃO por cima disso: cada etapa que o cliente cria declara qual dos 7 sinais
-- ela representa.
--
-- A alternativa — deixar cada cliente inventar o vocabulário que o agente teria que aprender — faria
-- o modelo classificar com palavras diferentes em cada workspace (onde ele erra mais) e obrigaria a
-- regenerar o prompt de todo agente existente. Assim o agente continua emitindo as 7 palavras que
-- ele já acerta, e a plataforma traduz pra etapa daquele funil.
--
-- Funil é OPCIONAL: workspace sem nenhum funil cadastrado continua exatamente como está hoje, com as
-- 7 fases renomeáveis. Criar um funil é uma escolha, não uma migração forçada.
create table if not exists pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  position integer not null default 0,
  -- Onde entra lead novo (do agente, de campanha, de importação) quando ninguém disse o funil.
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipelines_workspace on pipelines (workspace_id, position);

-- Um só funil padrão por workspace: com dois, "onde cai o lead novo" viraria sorteio.
create unique index if not exists idx_pipelines_default on pipelines (workspace_id) where is_default;

alter table pipelines enable row level security;
drop policy if exists "acesso a pipelines por workspace" on pipelines;
create policy "acesso a pipelines por workspace" on pipelines
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create table if not exists pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  -- workspace_id repetido de propósito: deixa a policy de RLS direta e evita join em toda leitura.
  workspace_id uuid not null references workspaces (id) on delete cascade,
  pipeline_id uuid not null references pipelines (id) on delete cascade,
  name text not null,
  -- O sinal interno que essa etapa representa. É o que liga o funil do cliente ao vocabulário fixo
  -- do agente e às métricas. Mesmos valores de contacts.stage.
  signal text not null check (
    signal in ('nao_abordado', 'abordado', 'interessado', 'encaminhamento', 'fechando_proposta', 'concluido', 'descartado')
  ),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_pipeline_stages_pipeline on pipeline_stages (pipeline_id, position);
create index if not exists idx_pipeline_stages_workspace on pipeline_stages (workspace_id);

alter table pipeline_stages enable row level security;
drop policy if exists "acesso a pipeline_stages por workspace" on pipeline_stages;
create policy "acesso a pipeline_stages por workspace" on pipeline_stages
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- Onde o lead está. `stage` continua preenchido em paralelo (é o sinal); estas duas colunas dizem em
-- qual funil e em qual etapa DAQUELE funil o card aparece.
-- `on delete set null`: apagar um funil nunca apaga lead — ele volta pro modo de 7 fases.
alter table contacts add column if not exists pipeline_id uuid references pipelines (id) on delete set null;
alter table contacts add column if not exists pipeline_stage_id uuid references pipeline_stages (id) on delete set null;
create index if not exists idx_contacts_pipeline on contacts (workspace_id, pipeline_id) where pipeline_id is not null;
