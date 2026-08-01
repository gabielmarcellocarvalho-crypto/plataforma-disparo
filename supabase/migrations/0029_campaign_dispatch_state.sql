-- Estado do motor de disparo (cron externo, chamado a cada minuto): `next_dispatch_at` controla o
-- delay aleatório entre um envio e outro dessa campanha; `dispatch_days` registra em quais dias
-- (BRT, "YYYY-MM-DD") a campanha já disparou, pra calcular a cota da rampa anti-ban do dia atual.
alter table campaigns add column next_dispatch_at timestamptz;
alter table campaigns add column dispatch_days jsonb not null default '[]'::jsonb;
