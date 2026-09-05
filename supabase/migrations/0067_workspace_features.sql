-- Funções ativas por workspace, e o motivo de perda deixando de ser obrigatório.
--
-- Antes, o que um cliente enxergava vinha de um PLANO fechado gravado no perfil de cada usuário
-- (access_type: "Disparo Avulso", "SDR", "Closer"...), com a lista de páginas de cada plano fixa no
-- código. Isso força todo cliente a caber num dos moldes e obriga uma alteração de código pra dizer
-- "esse aqui não usa Campanhas". Agora a decisão é do workspace e é manual: marca-se o que fica
-- oculto. Os planos continuam existindo como atalho que pré-marca as caixas.
--
-- Esconde pra TODO MUNDO daquele workspace, inclusive a equipe da agência: se o cliente não tem
-- agente de IA, "Agentes" não deveria ocupar espaço no menu de ninguém que trabalha nele.
alter table workspaces add column if not exists hidden_pages jsonb not null default '[]'::jsonb;

-- Perguntar o motivo ao mover um card pra perda é bom padrão, mas não é regra universal: operação
-- que não trabalha motivo de perda ganhava um diálogo no caminho sem pedir. Vira configuração,
-- ligada por padrão pra continuar valendo em quem já usa.
alter table workspaces add column if not exists ask_lost_reason boolean not null default true;
