-- CRM Luchini — Bloco 1 (campos do lead com esquema) e Bloco 2 (filiais + equipe).
-- Migrations 0063 e 0064. Cole o ARQUIVO INTEIRO no SQL Editor do Supabase e rode.
-- Idempotente: pode rodar de novo sem quebrar se uma parte já tiver sido aplicada.

-- ── 0063: campos personalizados COM ESQUEMA ──────────────────────────────
-- Antes eram só pares chave/valor digitados à mão em cada lead. O valor continua morando em
-- contacts.custom_fields (jsonb) — nada do que já existe muda de lugar. O que essa tabela adiciona é
-- a DEFINIÇÃO: rótulo, tipo, lista de opções válidas, se é obrigatório e onde aparece. É isso que
-- transforma "cidade: lavras" digitado torto em cada card num campo de verdade, igual em todo lead,
-- filtrável e somável em relatório.
--
-- Por que não virar coluna de contacts: cada cliente tem um conjunto diferente (a concessionária quer
-- cidade/produto/campanha; um hotel quer data de check-in) e o conjunto muda com o uso. Coluna
-- exigiria migration por cliente; jsonb + esquema resolve sem DDL.
create table if not exists custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Chave dentro de contacts.custom_fields. Imutável depois de criada (renomear quebraria o vínculo
  -- com os valores já gravados) — a UI edita o label, nunca a key.
  key text not null,
  label text not null,
  -- 'selecao'/'selecao_multipla' usam options; os outros ignoram.
  type text not null default 'texto' check (type in ('texto', 'texto_longo', 'numero', 'data', 'selecao', 'selecao_multipla')),
  options jsonb not null default '[]'::jsonb, -- array de strings, na ordem em que aparecem no select
  required boolean not null default false,
  show_in_table boolean not null default true, -- vira coluna em /contatos
  show_in_card boolean not null default false, -- vira etiqueta no card do Kanban (espaço é curto: poucos)
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_custom_field_defs_workspace on custom_field_defs (workspace_id, position);
create unique index if not exists idx_custom_field_defs_key on custom_field_defs (workspace_id, key);

alter table custom_field_defs enable row level security;
drop policy if exists "acesso a custom_field_defs por workspace" on custom_field_defs;
create policy "acesso a custom_field_defs por workspace" on custom_field_defs
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- ── 0064: filiais e equipe ───────────────────────────────────────────────
-- O time comercial do cliente COMO CADASTRO, não como conta de login. A rede da Luchini tem 5
-- filiais, ~20 vendedores, 5 gerentes e ainda peças/financeiro/pós-vendas — mas quem opera a
-- plataforma são 2-3 pessoas. Dar login pra todo mundo só pra poder dizer "esse lead é do Jader"
-- seria caro, inseguro e falso: vendedor e gerente nem são da operação que cuida do CRM. Então a
-- pessoa vira registro, e user_id fica opcional pra quando alguém do time precisar entrar de fato.
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  city text,
  phone text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_branches_workspace on branches (workspace_id, position);
create unique index if not exists idx_branches_workspace_name on branches (workspace_id, lower(name));

alter table branches enable row level security;
drop policy if exists "acesso a branches por workspace" on branches;
create policy "acesso a branches por workspace" on branches
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  -- Setor/cargo livre porque varia por cliente: aqui é vendedor/gerente/peças/financeiro/pós-vendas,
  -- em outro cliente vai ser outra coisa. Sem check pra não virar migration a cada palavra nova.
  role text,
  branch_id uuid references branches (id) on delete set null,
  phone text,
  email text,
  -- Desligado/afastado vira inativo em vez de ser apagado: os leads históricos dele precisam
  -- continuar apontando pra alguém, senão o relatório de "leads por vendedor" perde o passado.
  active boolean not null default true,
  -- Vínculo OPCIONAL com uma conta da plataforma. Quase sempre null.
  user_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_team_members_workspace on team_members (workspace_id);
create index if not exists idx_team_members_branch on team_members (branch_id) where branch_id is not null;
create unique index if not exists idx_team_members_workspace_name on team_members (workspace_id, lower(name));

alter table team_members enable row level security;
drop policy if exists "acesso a team_members por workspace" on team_members;
create policy "acesso a team_members por workspace" on team_members
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- Dono do lead na REDE do cliente (o vendedor que atendeu), separado de responsible_user_id, que
-- continua sendo quem opera a plataforma. São coisas diferentes de propósito: numa concessionária o
-- lead é do Jader (sem login) enquanto quem trabalha a fila na plataforma é a dupla do marketing.
-- on delete set null: apagar um membro nunca apaga lead.
alter table contacts add column if not exists team_member_id uuid references team_members (id) on delete set null;
create index if not exists idx_contacts_team_member on contacts (team_member_id) where team_member_id is not null;

-- Filial do lead. Normalmente é a filial do vendedor, mas fica explícita porque um lead pode chegar
-- pra uma filial ANTES de ter vendedor definido (na planilha da Luchini isso acontece o tempo todo).
alter table contacts add column if not exists branch_id uuid references branches (id) on delete set null;
create index if not exists idx_contacts_branch on contacts (branch_id) where branch_id is not null;
