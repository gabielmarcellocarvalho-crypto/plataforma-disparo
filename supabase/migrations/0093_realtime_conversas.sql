-- Conversas ao vivo: a tela assina INSERT/UPDATE dessas duas tabelas (filtradas pelo workspace) e se
-- atualiza quando chega mensagem ou muda o status do atendimento — sem checagem periódica.
-- O Realtime respeita o RLS que já existe (has_workspace_access): cada um só recebe o próprio workspace.
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.conversation_tickets;
