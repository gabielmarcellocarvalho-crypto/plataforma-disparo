-- Generaliza a biblioteca de mídia do agente pra aceitar documentos (PDF etc.), não só imagem.
-- media_type define como a Evolution/360dialog envia (image vs document); file_name é o nome que
-- aparece no WhatsApp quando é documento.
alter table agent_media add column media_type text not null default 'image' check (media_type in ('image', 'document'));
alter table agent_media add column file_name text;
