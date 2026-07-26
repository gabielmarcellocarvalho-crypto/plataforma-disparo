-- Quais das 3 fases opcionais do meio (interessado, encaminhamento, fechando_proposta) esse
-- workspace escolheu esconder do Kanban — as 4 âncoras (não abordado, abordado, concluído,
-- descartado) nunca podem ser escondidas. Array de chaves internas, ex.: ["encaminhamento"].
alter table workspaces add column crm_hidden_stages jsonb not null default '[]'::jsonb;
