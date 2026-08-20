-- Suporte real a campanha de e-mail no motor de disparo (antes só o worker legado, já removido,
-- sabia mandar e-mail — o motor atual (/api/cron/dispatch-campaigns) nunca teve isso implementado).
alter table campaigns add column subject text;

-- Remetente por workspace ("Nome <email@dominio.com.br>") — cada cliente pode ter seu próprio
-- domínio verificado no Resend (ex.: TB Rio usa tbrioelevadores2.com.br), não é 1 remetente global
-- pra todo mundo. Null = e-mail ainda não configurado pra esse workspace (campanha de e-mail falha
-- com mensagem clara em vez de mandar de um remetente errado).
alter table workspaces add column email_from text;
