-- Chatbot de mensagens iniciais em números SEM agente de IA (spec:
-- docs/superpowers/specs/2026-09-29-chatbot-mensagens-iniciais-design.md).
-- Idempotente: pode rodar de novo sem erro se uma parte já tiver sido aplicada.

-- Configuração no próprio número: { enabled, steps[], finalMessage }. Vazio/desligado = número se
-- comporta exatamente como antes.
alter table whatsapp_instances add column if not exists chatbot jsonb;

-- Em que etapa do bot cada lead está. Uma sessão por lead por número: o bot só roda no primeiro
-- contato, então nunca há duas conversas de bot com a mesma pessoa no mesmo número.
create table if not exists chatbot_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  instance_id uuid not null references whatsapp_instances (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  -- Etapa atual do bot (índice em chatbot.steps).
  step_index integer not null default 0,
  -- Tentativas na etapa atual (resposta inválida / mídia no lugar de texto) — no máximo 1 antes de seguir.
  retries integer not null default 0,
  -- 'ativo' | 'concluido' | 'interrompido' (humano respondeu, opt-out ou resposta inválida repetida)
  status text not null default 'ativo',
  -- Resumo do que o lead respondeu, pra observação no fim ({ "Cidade": "Lavras", ... }).
  answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists idx_chatbot_sessions_contact on chatbot_sessions (instance_id, contact_id);
create index if not exists idx_chatbot_sessions_active on chatbot_sessions (contact_id) where status = 'ativo';

-- RLS ligada e sem policy de escrita: só o servidor (service role) lê e escreve — o webhook e o envio
-- manual (que interrompe a sessão) usam o client admin. Nenhuma tela lê essa tabela direto.
alter table chatbot_sessions enable row level security;
