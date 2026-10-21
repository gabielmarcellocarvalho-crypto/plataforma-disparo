-- Filtros salvos do Pipeline: cada pessoa monta os filtros que usa no dia a dia (ex.: "Comercial —
-- meus leads") e guarda com um nome; eles viram atalhos no topo do Pipeline. São de quem criou —
-- cada vendedor decide os seus, e um não vê nem apaga os do outro.
-- Só adiciona uma tabela nova; idempotente. Sem ela o Pipeline segue sem a fileira de filtros salvos.
create table if not exists crm_saved_filters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  filters jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_crm_saved_filters_owner on crm_saved_filters (workspace_id, user_id, created_at);

alter table crm_saved_filters enable row level security;
drop policy if exists "filtros salvos de quem criou" on crm_saved_filters;
create policy "filtros salvos de quem criou" on crm_saved_filters
  for all using (user_id = auth.uid() and has_workspace_access(workspace_id))
  with check (user_id = auth.uid() and has_workspace_access(workspace_id));
