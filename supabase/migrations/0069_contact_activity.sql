-- Contagem de interações por contato, pra ordenar o Pipeline por "mais/menos conversado".
--
-- Precisa ser agregação no banco. A alternativa seria trazer uma linha de `messages` por mensagem e
-- contar no servidor Node: num workspace com dezenas de milhares de mensagens isso seriam dezenas de
-- páginas de 1000 linhas só pra montar um numerozinho por card.
--
-- `security invoker` de propósito: a função roda com as permissões de quem chamou, então a RLS de
-- `messages` continua valendo e ninguém enxerga contagem de outro workspace passando um id na mão.
-- O filtro por workspace_id fica explícito mesmo assim — defesa em profundidade, e é o que faz o
-- índice idx_messages_workspace ser usado.
create or replace function contact_message_counts(ws uuid)
returns table (contact_id uuid, total bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select m.contact_id, count(*) as total
    from messages m
   where m.workspace_id = ws
   group by m.contact_id;
$$;
