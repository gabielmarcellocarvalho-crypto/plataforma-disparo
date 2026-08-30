-- Empresas (CRM) — objeto novo, independente do funil de contacts.stage (que continua servindo só
-- a classificação de atendimento). Uma empresa agrupa contatos e negócios, no modelo padrão de CRM
-- (contato = pessoa, empresa = organização à qual ela pode pertencer).
create table companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  domain text, -- normalizado (lowercase, sem protocolo/www) no Server Action, pra dedupe por domínio
  website text, -- url livre, exibição
  phone text,
  industry text,
  custom_fields jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_companies_workspace on companies (workspace_id);
create index idx_companies_workspace_name on companies (workspace_id, lower(name));
create unique index idx_companies_workspace_domain on companies (workspace_id, lower(domain)) where domain is not null;

alter table companies enable row level security;
create policy "acesso a companies por workspace" on companies
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Observações internas sobre uma empresa — mesmo padrão de contact_notes (0018): histórico, nunca
-- sobrescreve, só visível pra equipe.
create table company_notes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  author_name text,
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_company_notes_company on company_notes (company_id, created_at desc);

alter table company_notes enable row level security;
create policy "acesso a company_notes por workspace" on company_notes
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Vínculo opcional contato → empresa primária. Aditivo e nullable — não mexe em contacts.stage nem
-- em nenhuma lógica de classificação de agente, cron ou webhook existente.
alter table contacts add column company_id uuid references companies (id) on delete set null;
create index idx_contacts_company on contacts (company_id) where company_id is not null;
-- Pipeline de negócios (Deals) — conceito de estágio totalmente separado de contacts.stage. Fase 1
-- cria 1 pipeline "Padrão" por workspace; o schema já comporta múltiplos pipelines no futuro sem
-- precisar de migration nova.
create table deal_pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null default 'Padrão',
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_deal_pipelines_workspace on deal_pipelines (workspace_id);
create unique index idx_deal_pipelines_one_default on deal_pipelines (workspace_id) where is_default;

alter table deal_pipelines enable row level security;
create policy "acesso a deal_pipelines por workspace" on deal_pipelines
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Estágios de um pipeline de negócios — nome/ordem/cor livres por workspace (diferente das 7 fases
-- fixas de contacts.stage). is_won/is_lost marcam os estágios terminais, usados por updateDealStage
-- pra setar deals.status automaticamente ao mover um card pra lá.
create table deal_stages (
  id uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references deal_pipelines (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade, -- denormalizado: RLS/índice simples sem join
  name text not null,
  position int not null,
  color text,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_deal_stages_pipeline on deal_stages (pipeline_id, position);
create index idx_deal_stages_workspace on deal_stages (workspace_id);

alter table deal_stages enable row level security;
create policy "acesso a deal_stages por workspace" on deal_stages
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Negócios (Deals) — oportunidade de venda com valor $, separada do estado de atendimento do
-- contato (contacts.stage). Pode estar ligado a uma empresa, a um contato direto, aos dois, ou (no
-- formulário de criação rápida) a nenhum ainda.
create table deals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  pipeline_id uuid not null references deal_pipelines (id) on delete cascade,
  stage_id uuid not null references deal_stages (id) on delete restrict, -- restrict: força mover os deals antes de apagar um estágio
  name text not null,
  company_id uuid references companies (id) on delete set null,
  contact_id uuid references contacts (id) on delete set null,
  amount numeric(14, 2),
  close_date date,
  responsible_user_id uuid references profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  custom_fields jsonb not null default '{}'::jsonb,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_deals_workspace on deals (workspace_id);
create index idx_deals_pipeline_stage on deals (pipeline_id, stage_id);
create index idx_deals_company on deals (company_id) where company_id is not null;
create index idx_deals_contact on deals (contact_id) where contact_id is not null;
create index idx_deals_responsible on deals (responsible_user_id) where responsible_user_id is not null;

alter table deals enable row level security;
create policy "acesso a deals por workspace" on deals
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Observações internas sobre um negócio — mesmo padrão de contact_notes/company_notes.
create table deal_notes (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  author_name text,
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_deal_notes_deal on deal_notes (deal_id, created_at desc);

alter table deal_notes enable row level security;
create policy "acesso a deal_notes por workspace" on deal_notes
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
-- Cria pipeline + 6 estágios padrão pra todo workspace já existente, e passa a criar automaticamente
-- em todo workspace novo daqui pra frente (trigger análogo ao handle_new_user de 0001_init.sql, mas
-- em "workspaces" — não há trigger nessa tabela ainda, então não há conflito).
insert into deal_pipelines (workspace_id, name, is_default)
select id, 'Padrão', true from workspaces
on conflict do nothing;

insert into deal_stages (pipeline_id, workspace_id, name, position, is_won, is_lost)
select p.id, p.workspace_id, s.name, s.position, s.is_won, s.is_lost
from deal_pipelines p
cross join (values
  ('Novo', 0, false, false),
  ('Qualificação', 1, false, false),
  ('Proposta', 2, false, false),
  ('Negociação', 3, false, false),
  ('Ganho', 4, true, false),
  ('Perdido', 5, false, true)
) as s(name, position, is_won, is_lost)
where p.is_default;

create function handle_new_workspace_deal_pipeline()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid;
begin
  insert into deal_pipelines (workspace_id, name, is_default) values (new.id, 'Padrão', true) returning id into pid;
  insert into deal_stages (pipeline_id, workspace_id, name, position, is_won, is_lost) values
    (pid, new.id, 'Novo', 0, false, false),
    (pid, new.id, 'Qualificação', 1, false, false),
    (pid, new.id, 'Proposta', 2, false, false),
    (pid, new.id, 'Negociação', 3, false, false),
    (pid, new.id, 'Ganho', 4, true, false),
    (pid, new.id, 'Perdido', 5, false, true);
  return new;
end;
$$;

create trigger on_workspace_created_deal_pipeline
  after insert on workspaces
  for each row execute function handle_new_workspace_deal_pipeline();
