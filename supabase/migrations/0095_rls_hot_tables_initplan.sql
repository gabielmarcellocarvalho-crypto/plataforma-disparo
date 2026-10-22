-- 0095: RLS das tabelas mais lidas (contacts, messages, campaign_recipients) calculada uma vez por
-- consulta, não por linha. has_workspace_access(workspace_id) chamava duas funções SECURITY DEFINER a
-- cada linha lida: 1000 mensagens iam de 0,9 ms (sem RLS) para ~104 ms. Com o is_agency_admin() dentro
-- de um select e a lista de workspaces do usuário calculada uma vez, cai para ~10 ms. Quem vê o quê não muda.

create or replace function my_workspace_ids()
returns setof uuid language sql stable security definer set search_path = public as $$
  select workspace_id from workspace_members where user_id = auth.uid()
$$;

drop policy "acesso a contatos por workspace" on contacts;
create policy "acesso a contatos por workspace" on contacts for all
  using ((select is_agency_admin()) or workspace_id in (select my_workspace_ids()))
  with check ((select is_agency_admin()) or workspace_id in (select my_workspace_ids()));

drop policy "acesso a mensagens por workspace" on messages;
create policy "acesso a mensagens por workspace" on messages for all
  using ((select is_agency_admin()) or workspace_id in (select my_workspace_ids()))
  with check ((select is_agency_admin()) or workspace_id in (select my_workspace_ids()));

drop policy "acesso a fila de disparo via campanha" on campaign_recipients;
create policy "acesso a fila de disparo via campanha" on campaign_recipients for all
  using ((select is_agency_admin()) or campaign_id in (
    select id from campaigns where workspace_id in (select my_workspace_ids())))
  with check ((select is_agency_admin()) or campaign_id in (
    select id from campaigns where workspace_id in (select my_workspace_ids())));
