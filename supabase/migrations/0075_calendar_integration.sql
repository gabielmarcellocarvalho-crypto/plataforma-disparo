-- Integração com Google Agenda do closer: o agente SDR marca reunião nos eventos "Marque aqui" que o
-- closer cria na própria agenda (spec: docs/superpowers/specs/2026-09-26-integracoes-google-agenda-design.md).

-- Uma conexão por pessoa da Equipe. O closer normalmente NÃO tem login na plataforma (team_members é
-- cadastro puro), por isso a chave é team_member_id e não user_id.
create table calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  team_member_id uuid not null references team_members (id) on delete cascade,
  provider text not null default 'google',
  account_email text,
  -- Refresh token cifrado (AES-256-GCM) com uma chave que só existe na Vercel. Mesmo com o banco
  -- vazado, o token sozinho não abre a agenda de ninguém.
  refresh_token_enc text not null,
  -- 'conectado' | 'reconectar' (autorização revogada/expirada — o closer sai do rodízio até reconectar)
  status text not null default 'conectado',
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_calendar_connections_member on calendar_connections (team_member_id);
create index idx_calendar_connections_workspace on calendar_connections (workspace_id);

-- RLS ligada e SEM nenhuma policy de propósito: nenhum usuário logado lê essa tabela direto (ela tem
-- o token). Tudo passa pelo servidor com service role, que devolve só as colunas não sensíveis.
alter table calendar_connections enable row level security;

-- Cada reunião que o agente marcou. Serve pro rodízio (quem recebeu reunião há mais tempo), pra
-- remarcar/cancelar o evento certo e pro selo no Pipeline.
create table meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  agent_id uuid references agents (id) on delete set null,
  team_member_id uuid references team_members (id) on delete set null,
  google_event_id text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  meet_link text,
  -- 'marcada' | 'remarcada' | 'cancelada'
  status text not null default 'marcada',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_meetings_member_created on meetings (team_member_id, created_at desc);
create index idx_meetings_contact_status on meetings (contact_id, status);
create index idx_meetings_workspace_starts on meetings (workspace_id, starts_at);

-- Leitura por workspace (Pipeline, painel do lead). Escrita só pelo servidor (agente), que usa service role.
alter table meetings enable row level security;
create policy "leitura de meetings por workspace" on meetings
  for select using (has_workspace_access(workspace_id));
