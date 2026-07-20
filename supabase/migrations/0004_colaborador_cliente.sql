-- Separa explicitamente "colaborador" (equipe da agência, acesso interno/multi-cliente)
-- de "cliente" (usuário restrito ao próprio workspace) no banco, em vez de um boolean solto.
alter table profiles add column role text not null default 'cliente' check (role in ('colaborador', 'cliente'));
update profiles set role = 'colaborador' where is_agency_admin = true;
alter table profiles drop column is_agency_admin;

-- Mesma função (nome mantido de propósito — nenhuma policy que já usa is_agency_admin() precisa mudar),
-- só troca a fonte do dado: agora lê profiles.role em vez do boolean antigo.
create or replace function is_agency_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select role = 'colaborador' from profiles where id = auth.uid()), false);
$$;
