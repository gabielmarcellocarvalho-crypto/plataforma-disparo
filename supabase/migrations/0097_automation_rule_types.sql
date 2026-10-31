-- Duas regras simples novas (nenhuma envia mensagem): lead novo sem abordagem e descartar contato sem resposta.
alter table public.automation_rules drop constraint automation_rules_type_check;
alter table public.automation_rules add constraint automation_rules_type_check
  check (type in ('contact_stale', 'new_untouched', 'stale_discard'));
