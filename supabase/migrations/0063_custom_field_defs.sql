-- Campos personalizados COM ESQUEMA (antes eram só pares chave/valor digitados à mão em cada lead).
-- O valor continua morando em `contacts.custom_fields` (jsonb) — nada do que já existe muda de lugar.
-- O que essa tabela adiciona é a DEFINIÇÃO: rótulo, tipo, lista de opções válidas, se é obrigatório
-- e onde aparece. É isso que transforma "cidade: lavras" digitado torto em cada card num campo de
-- verdade, igual em todo lead, filtrável e somável em relatório.
--
-- Por que não virar coluna de `contacts`: cada cliente tem um conjunto diferente (a concessionária
-- quer cidade/produto/campanha; um hotel quer data de check-in) e o conjunto muda com o uso. Coluna
-- exigiria migration por cliente; jsonb + esquema resolve sem DDL.
create table custom_field_defs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Chave dentro de contacts.custom_fields. Imutável depois de criada (renomear quebraria o vínculo
  -- com os valores já gravados) — a UI edita o `label`, nunca a `key`.
  key text not null,
  label text not null,
  -- 'selecao'/'selecao_multipla' usam `options`; os outros ignoram.
  type text not null default 'texto' check (type in ('texto', 'texto_longo', 'numero', 'data', 'selecao', 'selecao_multipla')),
  options jsonb not null default '[]'::jsonb, -- array de strings, na ordem em que aparecem no select
  required boolean not null default false,
  show_in_table boolean not null default true, -- vira coluna em /contatos
  show_in_card boolean not null default false, -- vira etiqueta no card do Kanban (espaço é curto: poucos)
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_custom_field_defs_workspace on custom_field_defs (workspace_id, position);
create unique index idx_custom_field_defs_key on custom_field_defs (workspace_id, key);

alter table custom_field_defs enable row level security;
create policy "acesso a custom_field_defs por workspace" on custom_field_defs
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
