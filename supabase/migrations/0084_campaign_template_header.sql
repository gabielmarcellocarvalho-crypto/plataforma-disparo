-- Campanha com template que tem cabeçalho de mídia (imagem ou documento). A Meta exige a mídia em cada
-- envio; sem isso o disparo falha com #132012 "header: Format mismatch, expected IMAGE, received UNKNOWN".
-- Idempotente: pode rodar de novo.

alter table campaigns add column if not exists template_header_format text;
alter table campaigns add column if not exists template_header_media_url text;
alter table campaigns add column if not exists template_header_media_name text;
