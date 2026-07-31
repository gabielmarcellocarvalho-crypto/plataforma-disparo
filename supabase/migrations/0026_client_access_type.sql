-- Tipo de acesso do cliente (não se aplica a colaborador) — controla quais páginas aparecem no menu
-- e são permitidas por URL direta. Nulo = sem restrição (comportamento antigo, preservado pra quem já
-- tem login criado até a agência classificar cada cliente em /acessos).
alter table profiles add column access_type text
  check (access_type is null or access_type in ('disparo_avulso', 'sdr', 'closer', 'sdr_light', 'ultra'));
