-- Conferência das migrations 0063 + 0064. Rodar DEPOIS do arquivo de aplicação.
-- Esperado: 5 linhas, todas com ok = true.
select 'tabela custom_field_defs' as item,
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'custom_field_defs') as ok
union all
select 'tabela branches',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'branches')
union all
select 'tabela team_members',
       exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'team_members')
union all
select 'coluna contacts.team_member_id',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'team_member_id')
union all
select 'coluna contacts.branch_id',
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'branch_id');
