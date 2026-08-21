-- Sequência de e-mails por dia (Dia 1, 5, 10, 15, 21...) — modo novo de campanha, além de
-- blast/agent. Cada passo tem assunto/corpo/rótulo de CTA próprios; o CTA sempre aponta pro mesmo
-- número de WhatsApp da campanha (cta_phone), com rastreio de clique via /api/e/<token>.
alter table campaigns drop constraint campaigns_mode_check;
alter table campaigns add constraint campaigns_mode_check check (mode in ('blast', 'agent', 'sequence'));

alter table campaigns add column sequence_steps jsonb not null default '[]'::jsonb;
alter table campaigns add column cta_phone text;
alter table campaigns add column cta_message text;

-- Progresso de cada contato dentro da sequência — independente do `status` já existente (que
-- continua descrevendo o último envio). stopped_reason != null trava o avanço pra sempre (clicou,
-- respondeu — fase 2 —, ou terminou os passos todos).
alter table campaign_recipients add column sequence_step int not null default 0;
alter table campaign_recipients add column next_step_at timestamptz;
alter table campaign_recipients add column stopped_reason text;

-- Um clique = uma linha, criada na hora do envio (token já existe antes da pessoa clicar) — permite
-- calcular taxa de clique (linhas com clicked_at preenchido / total de linhas) sem tabela separada
-- de "envios de passo".
create table email_clicks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  campaign_id uuid not null references campaigns (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  step int not null,
  token text not null unique,
  sent_at timestamptz not null default now(),
  clicked_at timestamptz
);
create index idx_email_clicks_workspace on email_clicks (workspace_id);
create index idx_email_clicks_campaign on email_clicks (campaign_id);

-- Escrita só acontece via admin client (cron do motor de sequência e a rota pública /api/e/<token>,
-- ambos com service role — passam direto por cima da RLS). A policy abaixo só existe pra liberar
-- leitura autenticada (Visão geral, via has_workspace_access, mesmo padrão das outras tabelas).
alter table email_clicks enable row level security;
create policy "acesso a cliques de e-mail por workspace" on email_clicks
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
