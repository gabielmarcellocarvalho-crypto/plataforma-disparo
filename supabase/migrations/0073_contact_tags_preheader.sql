-- Tags de contato + tags de campanha + preheader de e-mail (pedido do usuário a partir dos templates
-- reais do ENACAL, que já vinham rotulados "Tags: Aquecimento · Abertura" e com PREHEADER próprio —
-- duas coisas que a plataforma simplesmente não tinha onde guardar).
--
-- text[] e não jsonb: tag é lista de palavras, e os operadores nativos de array (&& = tem alguma
-- dessas, @> = tem todas) são exatamente os filtros de segmentação pedidos, com índice GIN barato.
alter table contacts add column tags text[] not null default '{}';
alter table campaigns add column tags text[] not null default '{}';

-- Segmentação de campanha filtra por "tem alguma dessas tags" (&&) na base inteira do workspace —
-- sem índice isso vira varredura por contato a cada ativação.
create index idx_contacts_tags on contacts using gin (tags);

-- Texto de pré-visualização que Gmail/Outlook mostram em cinza ao lado do assunto. Sem ele, o
-- cliente de e-mail puxa a primeira linha do corpo — que nos templates reais é "Olá, Fulano," e
-- desperdiça a única linha de chamada que o destinatário lê antes de decidir abrir.
alter table campaigns add column preheader text;

-- Lista de tags existentes no workspace, com quantos contatos cada uma tem — alimenta os seletores
-- (marcar tag ao importar, segmentar o disparo). Precisa ser função: o teto de 1000 linhas do
-- PostgREST impede montar "tags distintas" no client sem paginar a base inteira a cada abertura de
-- tela. security invoker de propósito, pra RLS de contacts continuar valendo: cada um só enxerga as
-- tags do próprio workspace.
create or replace function workspace_tags(ws_id uuid)
returns table (tag text, contacts_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select t.tag, count(*)::bigint as contacts_count
  from contacts c, unnest(c.tags) as t(tag)
  where c.workspace_id = ws_id
  group by t.tag
  order by count(*) desc, t.tag;
$$;
