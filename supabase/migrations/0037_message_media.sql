-- Guarda a mídia de fato (não só transcrição/legenda) pra dar pra visualizar áudio/imagem na tela
-- de Conversas. Cobre os dois sentidos: recebido do contato (áudio transcrito, foto de visão — hoje
-- descartados depois de usados) e enviado pelo agente via enviar_arquivo (hoje nem virava mensagem
-- registrada). Bucket público "conversation-media" no Supabase Storage guarda o arquivo em si.
alter table messages add column media_url text;
alter table messages add column media_type text check (media_type is null or media_type in ('image', 'audio', 'document'));
