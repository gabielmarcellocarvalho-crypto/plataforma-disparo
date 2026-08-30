-- Status de atendimento (aberto/pendente/resolvido) por conversa — conceito de fila de trabalho,
-- separado de contacts.needs_attention/flagged_reason (handoff IA↔humano) e de
-- contacts.responsible_user_id (dono do lead no CRM/SDR). "Conversa" não é uma linha no banco (é
-- sintetizada em conversas/page.tsx agrupando messages por contact_id + agent_id/instância), então o
-- vínculo é via conversation_key, calculada com o mesmo critério daquele agrupamento.
create table conversation_tickets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  agent_id uuid references agents (id) on delete cascade,
  -- "<contact_id>:agent:<agent_id>" ou "<contact_id>:instance" — coluna normal (não índice parcial)
  -- pra funcionar direto com upsert(onConflict) do supabase-js.
  conversation_key text not null,
  status text not null default 'aberto' check (status in ('aberto', 'pendente', 'resolvido')),
  responsible_user_id uuid references profiles (id) on delete set null,
  status_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index idx_conversation_tickets_key on conversation_tickets (workspace_id, conversation_key);
create index idx_conversation_tickets_workspace on conversation_tickets (workspace_id);

alter table conversation_tickets enable row level security;
create policy "acesso a conversation_tickets por workspace" on conversation_tickets
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
