-- Motivo de perda — por que o lead nao fechou.
--
-- E a informacao mais acionavel que uma operacao comercial coleta: "perdemos 236 por preco e 288 por
-- credito nao aprovado" muda decisao de estoque e de politica de credito, enquanto "perdemos 1277"
-- nao muda nada. A Luchini ja tabula isso na mao numa aba separada da planilha.
--
-- Fica em coluna propria, e nao como campo personalizado, por causa do MOMENTO: o motivo tem que ser
-- perguntado na hora em que o card vai pra fase de perda. Campo personalizado ninguem lembra de
-- preencher depois, e ai o relatorio vira uma coluna de vazios.
alter table contacts add column if not exists lost_reason text;
create index if not exists idx_contacts_lost_reason on contacts (workspace_id, lost_reason) where lost_reason is not null;

-- Lista de motivos aceitos, por workspace — mesma ideia de crm_stage_labels: cada cliente tem o
-- proprio vocabulario ("Credito nao aprovado" numa concessionaria, "Sem disponibilidade" num hotel).
-- Vazio = usa a lista padrao do codigo (ver src/lib/lost-reasons.ts).
alter table workspaces add column if not exists lost_reasons jsonb not null default '[]'::jsonb;
