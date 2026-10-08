-- Uma Página do Facebook pertence a UM workspace só. Sem isso, a conta do Facebook da agência (que
-- autoriza as páginas de vários clientes) fazia a página de um cliente aparecer, e poder ser ligada, no
-- workspace de outro, e o lead cairia nos dois.
--
-- ANTES de rodar: não pode haver página repetida entre workspaces, senão o índice falha. Conferir com:
--   select page_id, count(*) from facebook_pages group by page_id having count(*) > 1;
-- (deve voltar vazio)

create unique index if not exists idx_facebook_pages_page_unique on facebook_pages (page_id);
drop index if exists idx_facebook_pages_page;
