-- Estimativa de volume salva por workspace (pra clientes que ainda não têm campanha real rodando,
-- ou pra projetar cenário futuro). Quando setada, entra na conta do "volume total de todos os clientes"
-- da calculadora no lugar do volume real da fila de campanhas.
alter table workspaces add column estimated_email_volume integer;
alter table workspaces add column estimated_whatsapp_volume integer;
