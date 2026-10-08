-- Conexões de integrações externas por workspace (hoje: Nuvemshop; serve às próximas).
-- Spec: docs/superpowers/specs/2026-10-07-integracao-nuvemshop-design.md

create table integration_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- 'nuvemshop'
  provider text not null,
  -- Identificador da conta no provedor (Nuvemshop: o ID da loja).
  external_id text not null,
  display_name text,
  -- Token cifrado (AES-256-GCM, mesma chave dos tokens do Google Agenda). Mesmo com o banco
  -- vazado, o token sozinho não abre a loja de ninguém.
  credentials_enc text not null,
  -- Permissões que o workspace liberou (ids do catálogo em código). Vazio = conectado mas nada liberado.
  enabled_capabilities text[] not null default '{}',
  -- 'conectado' | 'reconectar' (token recusado pelo provedor)
  status text not null default 'conectado',
  last_error text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma conexão por provedor em cada workspace (v1: uma loja por workspace).
create unique index idx_integration_connections_workspace_provider on integration_connections (workspace_id, provider);

-- RLS ligada e SEM nenhuma policy de propósito: nenhum usuário logado lê essa tabela direto (ela tem
-- o token). Tudo passa pelo servidor com service role, que devolve só as colunas não sensíveis.
alter table integration_connections enable row level security;
