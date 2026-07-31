-- Plano comercial do workspace: define até onde o funil de conversão da Visão geral vai (SDR entrega
-- lead qualificado e para em "encaminhamento"; Closer e SDR+Closer conduzem até "concluido"). Nulo =
-- workspaces criados antes desse campo existir, tratado no código como 'sdr_closer' (funil completo,
-- o comportamento que já existia antes dessa mudança) até a agência classificar cada um.
alter table workspaces add column plan text
  check (plan is null or plan in ('sdr', 'closer', 'sdr_closer'));
