-- Workflows Fase 2 (pedido do usuário 2026-09-01): ramificação SIM/NÃO por condição, e limite de
-- reexecução mesmo com reentrada permitida.
--
-- Passos deixam de ser só uma lista linear (workflow_steps.position global): um passo do tipo
-- 'condition' agora pode ter filhos — passos que só rodam se a condição bater (branch='yes') ou não
-- bater (branch='no'). Passos de topo continuam com parent_step_id nulo, ordenados por position
-- entre si; filhos são ordenados por position dentro do próprio (parent_step_id, branch). Só 1 nível
-- de aninhamento por enquanto (uma condição dentro de um branch vira Fase 3, se precisar).
alter table workflow_steps add column parent_step_id uuid references workflow_steps (id) on delete cascade;
alter table workflow_steps add column branch text check (branch in ('yes', 'no'));
alter table workflow_steps drop constraint if exists workflow_steps_step_type_check;
alter table workflow_steps add constraint workflow_steps_step_type_check check (step_type in ('wait', 'action', 'condition'));
-- A unicidade de (workflow_id, position) da 0060 não faz mais sentido sozinha (filhos de branches
-- diferentes podem repetir position) — a ordem agora é garantida pela aplicação (replaceSteps faz
-- delete+insert completo a cada save, nunca update parcial).
alter table workflow_steps drop constraint if exists workflow_steps_workflow_id_position_key;

-- current_step_index (posição num array linear) não serve mais com ramificação — precisa apontar
-- pro passo exato (current_step_id), inclusive dentro de um branch. Feature nova sem execuções reais
-- em produção ainda, então troca direta sem preservar dado.
alter table workflow_runs drop column if exists current_step_index;
alter table workflow_runs add column current_step_id uuid references workflow_steps (id) on delete set null;

-- "Não executar mais de 1x por lead a cada X horas" (item 11 do usuário) — vale mesmo com
-- allow_reentry ligado; nulo = sem limite (só a trava de "1 execução ativa por vez" da 0060 vale).
alter table workflows add column reentry_cooldown_hours int check (reentry_cooldown_hours is null or reentry_cooldown_hours > 0);

-- step_index (posição num array linear) não faz mais sentido pro histórico com ramificação — troca
-- por referência direta ao passo.
alter table workflow_run_events drop column if exists step_index;
alter table workflow_run_events add column step_id uuid references workflow_steps (id) on delete set null;
