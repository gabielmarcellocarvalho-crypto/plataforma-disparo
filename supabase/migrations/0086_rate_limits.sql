-- Limite de requisições compartilhado entre todas as instâncias do app (login, recuperação de senha).
-- O limite em memória (src/lib/rate-limit.ts) vale só dentro de cada instância da Vercel; um atacante
-- que cai em instâncias diferentes contorna. Aqui a contagem fica no banco, atômica, e vale pra todas.
--
-- Só o service_role (servidor do app) executa estas funções. A tabela tem RLS ligada e nenhuma policy:
-- usuário logado ou anônimo não lê nem escreve nela. As chaves são hashes (nunca e-mail em texto).
-- O app trata falha do banco como "liberado" (um limite não pode derrubar o login), então rodar esta
-- migration não é pré-requisito pra nada quebrar. Idempotente: pode rodar de novo.

create table if not exists rate_limits (
  key text primary key,
  count integer not null,
  reset_at timestamptz not null
);
create index if not exists idx_rate_limits_reset_at on rate_limits (reset_at);
alter table rate_limits enable row level security;

-- Conta +1 na chave e diz se ainda está dentro do limite. Atômico (um único upsert).
create or replace function rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_reset timestamptz;
begin
  insert into rate_limits as r (key, count, reset_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when r.reset_at <= now() then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= now() then now() + make_interval(secs => p_window_seconds) else r.reset_at end
  returning r.count, r.reset_at into v_count, v_reset;

  -- Limpeza ocasional de chaves vencidas, pra tabela não crescer sem fim.
  if random() < 0.01 then
    delete from rate_limits where reset_at < now() - interval '1 hour';
  end if;

  allowed := v_count <= p_limit;
  retry_after := case when v_count <= p_limit then 0 else greatest(1, ceil(extract(epoch from (v_reset - now())))::integer) end;
  return next;
end;
$$;

-- Só olha, não conta: está bloqueado se já bateu o limite e a janela não venceu.
create or replace function rate_limit_peek(p_key text, p_limit integer)
returns table (allowed boolean, retry_after integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_reset timestamptz;
begin
  select r.count, r.reset_at into v_count, v_reset from rate_limits r where r.key = p_key;
  if v_count is null or v_reset <= now() or v_count < p_limit then
    allowed := true;
    retry_after := 0;
  else
    allowed := false;
    retry_after := greatest(1, ceil(extract(epoch from (v_reset - now())))::integer);
  end if;
  return next;
end;
$$;

-- Zera a chave (ex.: login certo apaga as falhas daquele e-mail).
create or replace function rate_limit_reset(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from rate_limits where key = p_key;
$$;

revoke all on function rate_limit_hit(text, integer, integer) from public, anon, authenticated;
revoke all on function rate_limit_peek(text, integer) from public, anon, authenticated;
revoke all on function rate_limit_reset(text) from public, anon, authenticated;
grant execute on function rate_limit_hit(text, integer, integer) to service_role;
grant execute on function rate_limit_peek(text, integer) to service_role;
grant execute on function rate_limit_reset(text) to service_role;
