-- Adiciona 'disparo_avulso' às opções válidas de workspaces.plan (só disparo em massa, sem agente —
-- sem funil/conversão na Visão geral). Constraint antigo (migration 0027) só aceitava sdr/closer/sdr_closer.
alter table workspaces drop constraint workspaces_plan_check;
alter table workspaces add constraint workspaces_plan_check
  check (plan is null or plan in ('sdr', 'closer', 'sdr_closer', 'disparo_avulso'));
