-- Adiciona 'sdr_disparo' às opções válidas de workspaces.plan (SDR qualifica/encaminha + disparo em
-- massa no mesmo workspace — funil igual ao SDR puro, até "encaminhamento").
alter table workspaces drop constraint workspaces_plan_check;
alter table workspaces add constraint workspaces_plan_check
  check (plan is null or plan in ('sdr', 'closer', 'sdr_closer', 'disparo_avulso', 'sdr_disparo'));
