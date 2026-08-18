-- Guarda quantas variáveis {{1}}, {{2}}... o corpo do template 360dialog escolhido tem, capturado no
-- momento da criação da campanha (a partir da lista real de templates aprovados da API) — o motor de
-- disparo usa isso pra saber se precisa mandar o primeiro nome do contato como parâmetro do corpo.
alter table campaigns add column dialog360_template_var_count int not null default 0;
