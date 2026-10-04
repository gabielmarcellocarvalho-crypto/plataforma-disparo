-- Qual campo da lista de contatos preenche cada variável ({{1}}, {{2}}…) de um template da Meta.
-- A Meta só guarda o texto; o vínculo com o campo do workspace fica aqui.
create table if not exists template_variable_maps (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  template_name text not null,
  language text not null,
  variables jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, template_name, language)
);

alter table template_variable_maps enable row level security;

drop policy if exists "leitura template_variable_maps" on template_variable_maps;
create policy "leitura template_variable_maps" on template_variable_maps for select using (has_workspace_access(workspace_id));
