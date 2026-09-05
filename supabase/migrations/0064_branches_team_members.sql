-- Filiais e equipe — o time comercial do cliente COMO CADASTRO, não como conta de login.
--
-- Motivação (concessionária Luchini Tratores): a rede tem 5 filiais, ~20 vendedores, 5 gerentes e
-- ainda peças/financeiro/pós-vendas — mas quem opera a plataforma são 2-3 pessoas. Dar login pra
-- todo mundo só pra poder dizer "esse lead é do Jader" seria caro, inseguro e falso: vendedor e
-- gerente nem são da operação que cuida do CRM. Então a pessoa vira registro, e `user_id` fica
-- opcional pra quando alguém do time realmente precisar entrar na plataforma.
create table branches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  city text,
  phone text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index idx_branches_workspace on branches (workspace_id, position);
create unique index idx_branches_workspace_name on branches (workspace_id, lower(name));

alter table branches enable row level security;
create policy "acesso a branches por workspace" on branches
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create table team_members (
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
create index idx_team_members_workspace on team_members (workspace_id);
create index idx_team_members_branch on team_members (branch_id) where branch_id is not null;
create unique index idx_team_members_workspace_name on team_members (workspace_id, lower(name));

alter table team_members enable row level security;
create policy "acesso a team_members por workspace" on team_members
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- Dono do lead na REDE do cliente (o vendedor que atendeu), separado de `responsible_user_id`, que
-- continua sendo quem opera a plataforma. São coisas diferentes de propósito: numa concessionária o
-- lead é do Jader (sem login) enquanto quem trabalha a fila na plataforma é a dupla do marketing.
-- `on delete set null`: apagar um membro nunca apaga lead.
alter table contacts add column team_member_id uuid references team_members (id) on delete set null;
create index idx_contacts_team_member on contacts (team_member_id) where team_member_id is not null;

-- Filial do lead. Normalmente é a filial do vendedor, mas fica explícita porque um lead pode chegar
-- pra uma filial ANTES de ter vendedor definido (na planilha da Luchini isso acontece o tempo todo).
alter table contacts add column branch_id uuid references branches (id) on delete set null;
create index idx_contacts_branch on contacts (branch_id) where branch_id is not null;
