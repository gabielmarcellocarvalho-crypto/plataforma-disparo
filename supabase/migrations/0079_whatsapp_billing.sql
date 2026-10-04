-- Custo oficial do WhatsApp (Meta cobra por mensagem entregue; tarifas em BRL na tela de Métricas).
--
-- 1) Categoria de cobrança de cada template enviado (marketing / utility / authentication).
--    Mensagem de texto livre (agente respondendo) fica com null: é "serviço", cobrada só acima de 1.000 por número/mês.
alter table messages add column if not exists billing_category text check (billing_category in ('marketing', 'utility', 'authentication'));

-- 2) Categoria do template da campanha oficial. Sem valor, o disparo é tratado como marketing (o mais caro: conta conservadora).
alter table campaigns add column if not exists template_category text check (template_category in ('marketing', 'utility', 'authentication'));

-- 3) Último clique em anúncio Click-to-WhatsApp desse contato. Dentro de 72h dele, as mensagens são grátis.
alter table contacts add column if not exists ctwa_at timestamptz;

create index if not exists idx_messages_billing on messages (workspace_id, created_at) where billing_category is not null;
