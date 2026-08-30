-- Cria pipeline + 6 estágios padrão pra todo workspace já existente, e passa a criar automaticamente
-- em todo workspace novo daqui pra frente (trigger análogo ao handle_new_user de 0001_init.sql, mas
-- em "workspaces" — não há trigger nessa tabela ainda, então não há conflito).
insert into deal_pipelines (workspace_id, name, is_default)
select id, 'Padrão', true from workspaces
on conflict do nothing;

insert into deal_stages (pipeline_id, workspace_id, name, position, is_won, is_lost)
select p.id, p.workspace_id, s.name, s.position, s.is_won, s.is_lost
from deal_pipelines p
cross join (values
  ('Novo', 0, false, false),
  ('Qualificação', 1, false, false),
  ('Proposta', 2, false, false),
  ('Negociação', 3, false, false),
  ('Ganho', 4, true, false),
  ('Perdido', 5, false, true)
) as s(name, position, is_won, is_lost)
where p.is_default;

create function handle_new_workspace_deal_pipeline()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  pid uuid;
begin
  insert into deal_pipelines (workspace_id, name, is_default) values (new.id, 'Padrão', true) returning id into pid;
  insert into deal_stages (pipeline_id, workspace_id, name, position, is_won, is_lost) values
    (pid, new.id, 'Novo', 0, false, false),
    (pid, new.id, 'Qualificação', 1, false, false),
    (pid, new.id, 'Proposta', 2, false, false),
    (pid, new.id, 'Negociação', 3, false, false),
    (pid, new.id, 'Ganho', 4, true, false),
    (pid, new.id, 'Perdido', 5, false, true);
  return new;
end;
$$;

create trigger on_workspace_created_deal_pipeline
  after insert on workspaces
  for each row execute function handle_new_workspace_deal_pipeline();
