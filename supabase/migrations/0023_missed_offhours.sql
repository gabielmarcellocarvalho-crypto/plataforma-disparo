-- Marca que o contato mandou mensagem fora do horário configurado e não foi respondido — usado pro
-- agente abrir com uma recapitulação curta na próxima mensagem dentro do horário, em vez de agir
-- como se nada tivesse ficado pendente. Limpo automaticamente depois que o agente responde de novo.
alter table contacts add column missed_offhours boolean not null default false;
