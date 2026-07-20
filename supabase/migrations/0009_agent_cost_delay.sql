-- Custo real por mensagem do agente (tokens da Anthropic) e delay humanizado antes de responder.
alter table messages add column input_tokens integer;
alter table messages add column output_tokens integer;

alter table agents add column reply_delay_min_seconds integer not null default 3;
alter table agents add column reply_delay_max_seconds integer not null default 12;
