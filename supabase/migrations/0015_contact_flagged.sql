-- Sinalização "pode precisar de atenção humana" que o agente emite ([[PRECISA_HUMANO]]) SEM parar
-- de responder — diferente de needs_attention, que muta o agente pra esse contato até um humano
-- assumir. Aparece como alerta dispensável na tela de Conversas; o cliente nunca sabe que existe.
alter table contacts add column flagged_reason text;
