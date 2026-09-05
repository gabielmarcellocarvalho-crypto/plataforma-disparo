-- Territórios — de que vendedor é cada cidade.
--
-- A Luchini já mantém isso numa aba da planilha: ~300 municípios de Minas divididos entre os 20
-- vendedores das 5 filiais. Hoje alguém lê a cidade do lead, procura na aba e repassa na mão. Com o
-- mapa no banco, o lead cai no dono certo sozinho — na importação, quando o agente descobre a cidade
-- na conversa, ou em massa nos leads que já estão sem responsável.
create table if not exists territories (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces (id) on delete cascade,
  -- Cidade como o cliente escreve (vai pra tela), e a forma normalizada que serve de chave: a mesma
  -- cidade aparece como "Três Pontas", "TRES PONTAS" e "três pontas" dependendo de quem digitou.
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

-- Qual campo personalizado do lead guarda a cidade. Não dá pra adivinhar pela chave "cidade": cada
-- cliente nomeia do seu jeito ("Município", "Praça", "Cidade de entrega"), e sem apontar
-- explicitamente o roteamento sairia lendo o campo errado.
alter table workspaces add column if not exists city_field_key text;
