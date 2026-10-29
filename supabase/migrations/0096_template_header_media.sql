-- Mídia do cabeçalho (imagem/PDF) dos templates criados pela AutomaX. A Meta pede a mídia em cada envio:
-- guardamos o caminho do arquivo (bucket conversation-media) por template, pra automações, follow-ups e
-- conversas mandarem sozinhos. Só o servidor grava; o workspace só lê.

create table if not exists template_header_media (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  template_name text not null,
  language text not null,
  format text not null check (format in ('IMAGE', 'DOCUMENT')),
  media_path text not null,
  media_name text,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, template_name, language)
);

alter table template_header_media enable row level security;

drop policy if exists "leitura template_header_media" on template_header_media;
create policy "leitura template_header_media" on template_header_media for select using (has_workspace_access(workspace_id));
