-- Chaves de API separadas por uso: 'entrada' (só envia leads pra cá, POST) e 'leitura' (só consulta,
-- pra dashboard/BI). 'completa' fica pras chaves criadas antes da separação, que fazem os dois.
alter table api_keys drop constraint if exists api_keys_scope_check;
alter table api_keys add constraint api_keys_scope_check check (scope in ('completa', 'entrada', 'leitura'));
