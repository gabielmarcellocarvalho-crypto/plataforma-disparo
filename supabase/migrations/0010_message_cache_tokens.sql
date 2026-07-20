-- Tokens de cache (prompt caching) das respostas do agente, pra custo real bater com o que a
-- Anthropic de fato cobra (cache write ~1.25x o preço de input, cache read ~0.1x).
alter table messages add column cache_creation_input_tokens integer;
alter table messages add column cache_read_input_tokens integer;
