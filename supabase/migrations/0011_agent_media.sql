-- Biblioteca de fotos por agente: o agente de IA usa a ferramenta enviar_foto(categoria) pra
-- mandar imagens (quartos, área de lazer, café da manhã, etc.) durante a conversa no WhatsApp.
create table agent_media (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references agents (id) on delete cascade,
  workspace_id uuid not null references workspaces (id) on delete cascade,
  category text not null, -- ex: "quarto standard", "piscina", "cafe da manha"
  url text not null,      -- URL pública da imagem (a Evolution/360dialog envia por URL)
  caption text,
  created_at timestamptz not null default now()
);
create index idx_agent_media_agent on agent_media (agent_id);

alter table agent_media enable row level security;
create policy "acesso a mídia por workspace" on agent_media
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
