-- Agenda própria de cada automação: em quais dias da semana e entre quais horários (horário de Brasília)
-- as mensagens dela podem sair. Formato: {"days":[1,2,3,4,5],"start":"09:00","end":"18:00"} (0=domingo ... 6=sábado).
-- schedule nulo = sem limite próprio; nesse caso vale o antigo "só horário comercial" (respect_business_hours).
-- Idempotente: pode rodar de novo.
alter table workflows add column if not exists schedule jsonb;

-- Quem já tinha "só horário comercial" ligado (seg-sáb, 9h-20h) ganha essa mesma janela na agenda nova,
-- então nada muda no comportamento das automações que já existem.
update workflows
set schedule = '{"days":[1,2,3,4,5,6],"start":"09:00","end":"20:00"}'::jsonb
where schedule is null and respect_business_hours = true;
