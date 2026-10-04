-- Alertas que a Meta manda quando reclassifica um template (evento template_category_update).
-- Guarda o histórico pra tela de Templates mostrar mesmo depois que o webhook já passou.
create table if not exists template_category_alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  waba_id text not null,
  template_id text,
  template_name text not null,
  language text,
  previous_category text,
  new_category text,
  correct_category text,
  created_at timestamptz not null default now()
);

create index if not exists idx_template_alerts_ws on template_category_alerts (workspace_id, created_at desc);

alter table template_category_alerts enable row level security;

drop policy if exists "leitura template_category_alerts" on template_category_alerts;
create policy "leitura template_category_alerts" on template_category_alerts for select using (has_workspace_access(workspace_id));
