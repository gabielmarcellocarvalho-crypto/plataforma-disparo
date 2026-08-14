-- Prepara whatsapp_instances pra falar com a API oficial (360dialog/Cloud API), não só Evolution.
-- 'evolution' é o default de propósito — nenhuma instância existente muda de comportamento.
alter table whatsapp_instances add column channel text not null default 'evolution' check (channel in ('evolution', '360dialog'));

-- Só preenchidos quando channel = '360dialog'. api_key é o D360-API-KEY (um por número/canal no
-- 360dialog); phone_number_id é o identificador que a Meta manda no webhook pra saber qual número
-- recebeu a mensagem (não dá pra descobrir isso só pelo telefone, como o Evolution faz por instance_name).
alter table whatsapp_instances add column dialog360_api_key text;
alter table whatsapp_instances add column phone_number_id text;
create unique index idx_whatsapp_instances_phone_number_id on whatsapp_instances (phone_number_id) where phone_number_id is not null;

-- instance_name era NOT NULL (nome da instância Evolution) — canal 360dialog não tem esse conceito,
-- então precisa virar opcional.
alter table whatsapp_instances alter column instance_name drop not null;
