-- Rodadas de campanha: cada (re)ativação vira uma rodada com números próprios, e o motivo de uma
-- campanha ativa estar travada (cota/domínio do e-mail, sem remetente, sem número) fica visível na tela.
alter table campaigns
  add column if not exists current_round int not null default 1,
  add column if not exists last_block_reason text,
  add column if not exists last_block_at timestamptz;

alter table campaign_recipients
  add column if not exists round int not null default 1;

create index if not exists campaign_recipients_campaign_round_idx on campaign_recipients (campaign_id, round);
