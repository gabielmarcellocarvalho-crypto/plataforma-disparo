-- Domínios de e-mail por workspace, gerenciados pela própria plataforma via API do Resend.
--
-- A tabela e o cliente da API (`src/lib/resend.ts`) foram escritos lá na migration 0003 e nunca
-- entraram no ar: a 0003 não rodou em produção e nenhum arquivo importava o cliente. Enquanto isso,
-- verificar domínio de cliente virou trabalho manual no painel do Resend. Esta migration recria a
-- tabela pra fechar esse buraco, e é idempotente de propósito: se algum ambiente chegou a rodar a
-- 0003, nada aqui explode.
--
-- `resend_domain_id` é único global: o mesmo domínio não pode ser reivindicado por dois workspaces,
-- quem verificou primeiro fica com ele. `status` e `dns_records` são espelho do Resend, atualizados a
-- cada consulta — a fonte da verdade é sempre o Resend, nunca esta tabela.
--
-- O nome da policy foge do padrão descritivo das outras migrations de propósito: identificador entre
-- aspas com espaços chegou corrompido no editor do Supabase em duas tentativas de colar.

create table if not exists email_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  resend_domain_id text not null unique,
  domain_name text not null,
  status text not null default 'not_started',
  dns_records jsonb not null default '[]'::jsonb,
  last_checked_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_email_domains_ws_domain
  on email_domains (workspace_id, domain_name);

alter table email_domains enable row level security;

drop policy if exists email_domains_ws on email_domains;

create policy email_domains_ws on email_domains
  for all using (has_workspace_access(workspace_id))
  with check (has_workspace_access(workspace_id));
