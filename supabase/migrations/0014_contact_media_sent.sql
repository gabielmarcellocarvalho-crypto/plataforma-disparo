-- Evita reenviar o mesmo arquivo pro mesmo contato quando o agente usa a ferramenta de enviar
-- arquivo mais de uma vez na conversa. Universal — vale pra qualquer agente com biblioteca de mídia.
create table contact_media_sent (
  contact_id uuid not null references contacts (id) on delete cascade,
  agent_media_id uuid not null references agent_media (id) on delete cascade,
  sent_at timestamptz not null default now(),
  primary key (contact_id, agent_media_id)
);

alter table contact_media_sent enable row level security;
create policy "acesso a contact_media_sent por workspace" on contact_media_sent
  for all using (
    has_workspace_access((select workspace_id from contacts where id = contact_id))
  ) with check (
    has_workspace_access((select workspace_id from contacts where id = contact_id))
  );
