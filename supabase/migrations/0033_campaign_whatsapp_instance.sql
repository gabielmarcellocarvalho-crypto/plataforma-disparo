-- Prepara campanhas pra escolher QUAL número/departamento dispara (necessário assim que um workspace
-- tem mais de 1 whatsapp_instances — ex.: TB Rio com Vendas e Financeiro) e pra disparo frio via
-- 360dialog/Cloud API, que exige Message Template pré-aprovado pela Meta (não aceita texto livre
-- fora da janela de 24h, ao contrário do Evolution). Null = comportamento de hoje (resolve pelo único
-- número do workspace, mensagem livre via Evolution).
alter table campaigns add column whatsapp_instance_id uuid references whatsapp_instances (id) on delete set null;
alter table campaigns add column dialog360_template_name text;
alter table campaigns add column dialog360_template_lang text;
create index idx_campaigns_whatsapp_instance on campaigns (whatsapp_instance_id);
