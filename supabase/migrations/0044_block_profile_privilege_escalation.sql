-- Achado CRÍTICO da auditoria de segurança (SECURITY_AUDIT.md #1): a policy de update em `profiles`
-- ("usuário edita o próprio perfil", 0001_init.sql) só checa `id = auth.uid()`, sem `with check` — RLS
-- no Postgres é sempre por LINHA, nunca por coluna, então qualquer usuário autenticado consegue chamar
-- a API REST do Supabase direto (fora do Next.js) e fazer update({role: 'colaborador'}) na própria
-- linha, virando colaborador e ganhando acesso a todos os workspaces de todos os clientes (is_agency_admin()
-- lê exatamente essa coluna). Bloqueia isso com um trigger: só quem já é colaborador pode mudar
-- role/access_type de qualquer perfil (inclusive o próprio) — usuário comum só edita full_name.
--
-- auth.role() = 'service_role' sempre passa: é o client admin (SUPABASE_SERVICE_ROLE_KEY, usado só em
-- src/app/actions/access.ts, que já checa isCurrentUserColaborador() na camada de aplicação antes de
-- chamar) — sem essa exceção, criar/editar acesso de cliente pela tela da Agência quebraria, porque o
-- client admin não carrega sessão de usuário (auth.uid() vem NULL nesse contexto, então is_agency_admin()
-- também retornaria false, mesmo sendo uma operação legítima feita pela própria agência).
create or replace function block_self_privilege_escalation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if not is_agency_admin() then
    if new.role is distinct from old.role or new.access_type is distinct from old.access_type then
      raise exception 'Não é permitido alterar role/access_type da própria conta.';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_block_self_privilege_escalation
  before update on profiles
  for each row execute function block_self_privilege_escalation();
