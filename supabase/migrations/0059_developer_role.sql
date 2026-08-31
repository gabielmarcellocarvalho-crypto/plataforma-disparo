-- Sistema de 3 níveis de acesso (pedido do usuário, 2026-08-30):
--   cliente     — acesso restrito a 1 workspace, páginas limitadas pelo access_type (sem mudança).
--   colaborador — REDEFINIDO: membro de equipe escopado a workspace(s) específico(s) via
--                 workspace_members (mesmo mecanismo de cliente), com acesso completo às
--                 funcionalidades desses workspaces (gerencia agentes, vê custo, edita configuração —
--                 tudo que "colaborador" já fazia), mas NÃO enxerga mais workspaces fora dos seus nem
--                 telas de agência (Acessos, Calculadora, criar/apagar cliente).
--   developer   — NOVO nível top: é o que "colaborador" significava até agora — enxerga e opera
--                 TODOS os workspaces, único que acessa Acessos/Calculadora/cria ou remove cliente.
--
-- Migração de dados: promove todo colaborador EXISTENTE pra developer (decisão do usuário) — ninguém
-- da equipe atual perde acesso a nada nesse momento; colaborador novo criado daqui pra frente já nasce
-- escopado a workspace(s) específico(s) via /acessos.
-- Constraint precisa aceitar 'developer' ANTES do update abaixo, senão a própria update viola o
-- check antigo (que só permitia colaborador/cliente).
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('colaborador', 'cliente', 'developer'));

update profiles set role = 'developer' where role = 'colaborador';

-- is_agency_admin() é usada em TODA policy de "acesso a workspace" do sistema (has_workspace_access,
-- inserir/atualizar workspaces, gerenciar workspace_members) — redefinir pra 'developer' já propaga
-- corretamente pra tudo isso sem tocar em mais nenhuma policy. colaborador (agora escopado) passa a
-- depender só de is_workspace_member(), igual cliente sempre dependeu.
create or replace function is_agency_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce((select role = 'developer' from profiles where id = auth.uid()), false);
$$;
