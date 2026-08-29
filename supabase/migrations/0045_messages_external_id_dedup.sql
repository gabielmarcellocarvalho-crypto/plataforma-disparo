-- Idempotência de webhook (SECURITY_AUDIT.md, Fase 2 — "Efeito tempestade"): processWebhook e
-- processDialog360Webhook não checavam se aquele messageId/wamid já tinha sido processado antes de
-- inserir em `messages` e chamar o LLM — um replay/retry do provedor (reconexão da Evolution, retry da
-- Meta) geraria resposta duplicada do agente e cobraria a API 2x pela mesma mensagem.
alter table messages add column external_id text;

-- Parcial (só quando existe) e por workspace: o mesmo wamid nunca deveria se repetir dentro do mesmo
-- workspace, mas dois workspaces diferentes podem, em teoria, reportar ids com o mesmo formato sem
-- relação nenhuma entre si — escopar por workspace evita falso-positivo de dedup entre clientes.
create unique index idx_messages_workspace_external_id on messages (workspace_id, external_id) where external_id is not null;
