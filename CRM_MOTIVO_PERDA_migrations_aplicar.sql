-- CRM Luchini — Bloco 4: motivo de perda. Migration 0065.
-- Cole o ARQUIVO INTEIRO no SQL Editor do Supabase e rode. Idempotente.
--
-- Por que coluna propria e nao campo personalizado: o motivo tem que ser perguntado NO MOMENTO em
-- que o card vai pra fase de perda. Campo personalizado ninguem lembra de preencher depois, e o
-- relatorio vira uma coluna de vazios. "Perdemos 236 por preco e 288 por credito nao aprovado" muda
-- decisao de estoque e de politica de credito; "perdemos 1277" nao muda nada.
alter table contacts add column if not exists lost_reason text;
create index if not exists idx_contacts_lost_reason on contacts (workspace_id, lost_reason) where lost_reason is not null;

-- Lista de motivos aceitos, por workspace — mesma ideia de crm_stage_labels: cada cliente tem o
-- proprio vocabulario. Vazio = usa a lista padrao do codigo (src/lib/lost-reasons.ts).
alter table workspaces add column if not exists lost_reasons jsonb not null default '[]'::jsonb;

-- Motivos da Luchini, tirados da aba de fechado/perdido da planilha deles.
update workspaces
   set lost_reasons = '["Preço","Crédito não aprovado","Desistência","Produto indisponível","Problemas não resolvidos","Condição de pagamento","Produto não aderente","Preferência de marca","Prazo de entrega","Falta de atendimento"]'::jsonb
 where id = '8cd60e8e-55ae-4c87-b69a-795e7d34f695'
   and lost_reasons = '[]'::jsonb;
