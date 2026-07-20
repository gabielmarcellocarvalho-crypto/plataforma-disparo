-- Plataforma de Disparo — schema inicial (multi-tenant via workspace_id + RLS)
-- Rodar no SQL Editor do Supabase, ou via `supabase db push` quando o CLI estiver configurado.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ── Perfis (1:1 com auth.users) ──────────────────────────────────────────
-- is_agency_admin = enxerga e opera todos os workspaces (equipe da agência).
create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  is_agency_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Cria o profile automaticamente quando um usuário novo se cadastra no Supabase Auth.
create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── Workspaces (1 por cliente) ────────────────────────────────────────────
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

-- ── Membros de cada workspace ─────────────────────────────────────────────
create table workspace_members (
  workspace_id uuid not null references workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- ── Funções auxiliares de RLS ─────────────────────────────────────────────
create function is_agency_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select is_agency_admin from profiles where id = auth.uid()), false);
$$;

create function is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

create function has_workspace_access(ws_id uuid)
returns boolean
language sql
stable
as $$
  select is_agency_admin() or is_workspace_member(ws_id);
$$;

-- ── Contatos ──────────────────────────────────────────────────────────────
create table contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text,
  phone text, -- só dígitos, com DDI (ex.: 5511999998888)
  email text,
  custom_fields jsonb not null default '{}'::jsonb,
  opt_out_whatsapp boolean not null default false,
  opt_out_email boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_contacts_workspace on contacts (workspace_id);
-- Sem WHERE de propósito: precisa ser um índice "cheio" pra funcionar com ON CONFLICT/upsert na importação.
-- NULLs continuam podendo se repetir (comportamento padrão do SQL: NULL != NULL).
create unique index idx_contacts_workspace_phone on contacts (workspace_id, phone);
create unique index idx_contacts_workspace_email on contacts (workspace_id, email) where email is not null;

-- ── Instâncias de WhatsApp (Evolution API) por workspace ──────────────────
create table whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  instance_name text not null unique, -- nome usado na Evolution API
  connection_status text not null default 'desconectado',
  created_at timestamptz not null default now()
);
create index idx_whatsapp_instances_workspace on whatsapp_instances (workspace_id);

-- ── Campanhas ─────────────────────────────────────────────────────────────
create table campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('whatsapp', 'email')),
  mode text not null default 'blast' check (mode in ('blast', 'agent')), -- só 'blast' implementado por ora
  message_templates jsonb not null default '[]'::jsonb, -- lista de variações de mensagem/template
  ramp_config jsonb not null default '{}'::jsonb, -- rampa/janela/delay (mesmo formato usado na Hanoi)
  status text not null default 'rascunho' check (status in ('rascunho', 'ativa', 'pausada', 'concluida')),
  created_at timestamptz not null default now()
);
create index idx_campaigns_workspace on campaigns (workspace_id);

-- ── Fila de envio por campanha ────────────────────────────────────────────
create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  status text not null default 'pendente' check (status in ('pendente', 'enviado', 'falhou', 'invalido')),
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);
create index idx_campaign_recipients_campaign on campaign_recipients (campaign_id);
create index idx_campaign_recipients_pending on campaign_recipients (campaign_id, status) where status = 'pendente';

-- ── Histórico de mensagens (WhatsApp) por contato ─────────────────────────
create table messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  contact_id uuid not null references contacts (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  created_at timestamptz not null default now()
);
create index idx_messages_workspace on messages (workspace_id);
create index idx_messages_contact on messages (contact_id);

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table contacts enable row level security;
alter table whatsapp_instances enable row level security;
alter table campaigns enable row level security;
alter table campaign_recipients enable row level security;
alter table messages enable row level security;

create policy "usuário vê o próprio perfil" on profiles
  for select using (id = auth.uid() or is_agency_admin());
create policy "usuário edita o próprio perfil" on profiles
  for update using (id = auth.uid());

create policy "acesso a workspaces por membership" on workspaces
  for select using (has_workspace_access(id));
create policy "agência cria workspaces" on workspaces
  for insert with check (is_agency_admin());
create policy "agência atualiza workspaces" on workspaces
  for update using (is_agency_admin());

create policy "acesso a membros por workspace" on workspace_members
  for select using (has_workspace_access(workspace_id));
create policy "agência gerencia membros" on workspace_members
  for all using (is_agency_admin()) with check (is_agency_admin());

create policy "acesso a contatos por workspace" on contacts
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create policy "acesso a instâncias por workspace" on whatsapp_instances
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create policy "acesso a campanhas por workspace" on campaigns
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

create policy "acesso a fila de disparo via campanha" on campaign_recipients
  for all using (
    has_workspace_access((select workspace_id from campaigns where id = campaign_id))
  ) with check (
    has_workspace_access((select workspace_id from campaigns where id = campaign_id))
  );

create policy "acesso a mensagens por workspace" on messages
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));
