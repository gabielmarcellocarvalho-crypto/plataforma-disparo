-- Funções ativas por workspace + motivo de perda opcional. Migration 0067.
-- Cole o ARQUIVO INTEIRO no SQL Editor do Supabase e rode. Idempotente.
--
-- Antes, o que um cliente enxergava vinha de um PLANO fechado gravado no perfil de cada usuario
-- ("Disparo Avulso", "SDR", "Closer"...), com a lista de paginas de cada plano fixa no codigo. Isso
-- forca todo cliente a caber num dos moldes e exige alteracao de codigo pra dizer "esse aqui nao usa
-- Campanhas". Agora a decisao e do workspace e e manual: marca-se o que fica oculto. Os planos
-- continuam existindo como atalho que pre-marca as caixas.
--
-- Esconde pra TODO MUNDO daquele workspace, inclusive a equipe da agencia: se o cliente nao tem
-- agente de IA, "Agentes" nao deveria ocupar espaco no menu de ninguem que trabalha nele.
--
-- Default '[]' = nada oculto, entao nenhum cliente que ja existe muda de comportamento ao aplicar.
alter table workspaces add column if not exists hidden_pages jsonb not null default '[]'::jsonb;

-- Perguntar o motivo ao mover um card pra perda e bom padrao, mas nao e regra universal: operacao
-- que nao trabalha motivo de perda ganhava um dialogo no caminho sem pedir. Vira configuracao,
-- ligada por padrao pra continuar valendo em quem ja usa.
alter table workspaces add column if not exists ask_lost_reason boolean not null default true;
