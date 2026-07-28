-- Chaves de API por workspace, pra plataforma terceira (form de site, outro CRM, Zapier/Make)
-- criar lead direto na Plataforma-Disparo sem passar pelo WhatsApp. Só o hash fica salvo — a chave
-- em texto puro é mostrada uma única vez na hora da criação (mesmo padrão de secret de API comum).
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  key_prefix text not null, -- primeiros caracteres, só pra identificar qual chave é qual na lista
  key_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index idx_api_keys_workspace on api_keys (workspace_id);
create unique index idx_api_keys_hash on api_keys (key_hash);

alter table api_keys enable row level security;
create policy "acesso a api_keys por workspace" on api_keys
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
