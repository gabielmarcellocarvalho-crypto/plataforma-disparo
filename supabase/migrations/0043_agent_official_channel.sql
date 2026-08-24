-- Agente de IA passa a poder usar um número já conectado em Configurações (360dialog/metacloud) em vez
-- de ter obrigatoriamente sua própria instância Evolution — permite 1 número servir tanto disparo em
-- massa quanto o agente SDR (caso Renault: campanha manda o template, o mesmo número depois conduz a
-- conversa via agente). evolution_instance_name vira opcional; quando whatsapp_instance_id está
-- preenchido, o agente usa o canal/credenciais dessa instância pra enviar/receber.
alter table agents alter column evolution_instance_name drop not null;
alter table agents add column whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null;

-- 1 número conectado só pode estar vinculado a 1 agente por vez (não faz sentido 2 agentes
-- competindo pela mesma conversa recebida no mesmo phone_number_id).
create unique index idx_agents_whatsapp_instance on agents (whatsapp_instance_id) where whatsapp_instance_id is not null;
