-- Passagem de bastão entre agentes: o SDR qualifica e entrega pro Closer.
--
-- Dois modos, porque as duas operações existem de verdade:
--   'papel'  — mesmo número. Ao qualificar, quem responde passa a ser o outro agente (outro prompt,
--              outro objetivo), sem o cliente perceber troca nenhuma. O agente de destino não
--              precisa de número próprio: existe só como "cérebro".
--   'numero' — dois números. O agente de destino se apresenta no número dele e conduz dali. Serve
--              pra quando SDR e Closer são times diferentes, com caixas de entrada separadas.
--
-- Desligado por padrão em todo agente que já existe: sem `handoff_to_agent_id`, nada muda.
alter table agents add column if not exists handoff_to_agent_id uuid references agents (id) on delete set null;

alter table agents add column if not exists handoff_mode text not null default 'papel'
  check (handoff_mode in ('papel', 'numero'));

-- Qual classificação do funil dispara a passagem. Usa o mesmo vocabulário de contacts.stage, que é o
-- que o agente já emite a cada resposta — não inventa um segundo sinal só pra isso.
alter table agents add column if not exists handoff_signal text not null default 'encaminhamento'
  check (handoff_signal in ('abordado', 'interessado', 'encaminhamento', 'fechando_proposta'));

-- Primeira mensagem enviada pelo número de quem assume (modo 'numero'). Fica no agente de ORIGEM,
-- junto do resto da configuração da passagem: é uma decisão só, num formulário só. O cliente está
-- vendo um número desconhecido aparecer do nada; sem uma apresentação, a conversa fica confusa.
alter table agents add column if not exists handoff_intro text;

-- O que o agente que PASSOU responde se o cliente continuar escrevendo no número antigo. Sem isso a
-- escolha seria entre ignorar o cliente ou ter dois agentes falando por cima um do outro.
alter table agents add column if not exists handoff_notice text;

-- Quem é o "cérebro" da conversa desse contato agora. Null = o agente do próprio número, como sempre.
alter table contacts add column if not exists active_agent_id uuid references agents (id) on delete set null;
alter table contacts add column if not exists handed_off_at timestamptz;
create index if not exists idx_contacts_active_agent on contacts (active_agent_id) where active_agent_id is not null;
