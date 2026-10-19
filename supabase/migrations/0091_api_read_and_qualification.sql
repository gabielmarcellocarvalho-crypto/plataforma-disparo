-- API de leitura pra dashboard/BI: chave só de leitura e classificação dos leads (MQL/SQL/...).
--
-- api_keys.scope: 'completa' (envia e lê leads, como sempre foi) ou 'leitura' (só GET: não cria nem
-- altera lead). Chave existente continua completa, então nada muda pra quem já integra.
alter table api_keys add column if not exists scope text not null default 'completa';
alter table api_keys drop constraint if exists api_keys_scope_check;
alter table api_keys add constraint api_keys_scope_check check (scope in ('completa', 'leitura'));

-- workspaces.lead_qualification: a partir de qual etapa do funil o lead conta como MQL, SQL e
-- oportunidade, e quais desses níveis o cliente usa. Nulo = padrão do código (src/lib/lead-qualification.ts).
alter table workspaces add column if not exists lead_qualification jsonb;
