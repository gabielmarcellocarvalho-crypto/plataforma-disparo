-- Rode DEPOIS do AGENTE_HANDOFF_migrations_aplicar.sql, antes de liberar o deploy.
-- As 5 colunas de `agents` são as que os webhooks passaram a selecionar em AGENT_COLUMNS:
-- se qualquer uma faltar, o select falha e o agente para de responder em produção.

-- 1) Deve retornar exatamente 5 linhas.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'agents'
   and column_name in (
     'handoff_to_agent_id',
     'handoff_mode',
     'handoff_signal',
     'handoff_intro',
     'handoff_notice'
   )
 order by column_name;

-- 2) Deve retornar exatamente 2 linhas (active_agent_id, handed_off_at).
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'contacts'
   and column_name in ('active_agent_id', 'handed_off_at')
 order by column_name;

-- 3) O índice parcial de contacts. Deve retornar 1 linha.
select indexname
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'idx_contacts_active_agent';

-- 4) Prova de que a passagem nasce DESLIGADA em todo agente existente:
--    com_destino tem que ser 0, e modo/sinal iguais ao default em todos.
select count(*)                                            as total_agentes,
       count(handoff_to_agent_id)                          as com_destino,
       count(*) filter (where handoff_mode = 'papel')      as modo_papel,
       count(*) filter (where handoff_signal = 'encaminhamento') as sinal_padrao
  from agents;

-- 5) Nenhum contato pode já estar com bastão passado.
select count(*) as contatos_com_agente_ativo
  from contacts
 where active_agent_id is not null;
