-- AutomaX virou Tech Provider da Meta (WhatsApp Business Solution) — clientes novos passam a conectar
-- direto via Embedded Signup (Cloud API), sem passar pelo 360dialog como intermediário. Clientes que já
-- estão no 360dialog (ex.: TB Rio) continuam nesse canal — não migra ninguém automaticamente.
alter table whatsapp_instances drop constraint whatsapp_instances_channel_check;
alter table whatsapp_instances add constraint whatsapp_instances_channel_check check (channel in ('evolution', '360dialog', 'metacloud'));

-- WABA ID (WhatsApp Business Account) — só existe no modelo direto da Meta, é o escopo de gestão de
-- templates (/{waba_id}/message_templates) e de assinatura do webhook (/{waba_id}/subscribed_apps).
-- phone_number_id (coluna já existente, criada em 0032) é reaproveitado igual: é o mesmo conceito da
-- Cloud API nos dois canais (identifica o número no envio e no payload do webhook recebido).
alter table whatsapp_instances add column meta_waba_id text;
