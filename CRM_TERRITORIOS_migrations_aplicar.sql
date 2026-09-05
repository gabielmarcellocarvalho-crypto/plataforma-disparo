-- CRM Luchini — Bloco 6: territórios (cidade -> vendedor). Migration 0066.
-- Cole o ARQUIVO INTEIRO no SQL Editor do Supabase e rode. Idempotente.
--
-- A Luchini já mantém esse mapa numa aba da planilha: ~200 municípios de Minas divididos entre os 19
-- vendedores das 5 filiais. Hoje alguem le a cidade do lead, procura na aba e repassa na mao. Com o
-- mapa no banco, o lead cai no dono certo sozinho — na importacao de planilha, quando o agente
-- descobre a cidade no meio da conversa, e em massa nos leads que ja estao sem responsavel.
create table if not exists territories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Cidade como o cliente escreve (vai pra tela) e a forma normalizada que serve de chave: a mesma
  -- cidade aparece como "Três Pontas", "TRES PONTAS" e "Três Pontas - MG" dependendo de quem digitou.
  city text not null,
  city_key text not null,
  team_member_id uuid references team_members (id) on delete cascade,
  branch_id uuid references branches (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists idx_territories_workspace on territories (workspace_id, city_key);
create unique index if not exists idx_territories_city on territories (workspace_id, city_key);

alter table territories enable row level security;
drop policy if exists "acesso a territories por workspace" on territories;
create policy "acesso a territories por workspace" on territories
  for all using (has_workspace_access(workspace_id)) with check (has_workspace_access(workspace_id));

-- Qual campo personalizado do lead guarda a cidade. Nao da pra adivinhar pela chave "cidade": cada
-- cliente nomeia do seu jeito ("Municipio", "Praca", "Cidade de entrega"), e sem apontar
-- explicitamente o roteamento sairia lendo o campo errado.
alter table workspaces add column if not exists city_field_key text;
