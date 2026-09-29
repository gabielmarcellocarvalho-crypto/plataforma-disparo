# Chatbot de mensagens iniciais (números sem IA)

Data: 2026-09-29 · Status: aprovado em conversa · Primeiro cliente: Luchini Tratores

## Objetivo

Em números de WhatsApp **sem agente de IA**, fazer o primeiro atendimento automático de um lead novo:
perguntas fixas e menu de opções que preenchem o cadastro, aplicam etiquetas/etapa no CRM e direcionam
pra loja/vendedor certo (roteamento por território), antes de a equipe humana assumir.

Pedido da Luchini: "coletar as informações pra completar o cadastro e direcionar corretamente entre as
lojas" — pergunta a cidade, depois menu (Tratores Novos / Usados / Implementos / Peças e oficina / Outros).

## Decisões travadas

| Tema | Decisão |
|---|---|
| Onde vale | Só números **sem agente de IA** (`whatsapp_instances` sem agente vinculado). Um número tem IA **ou** chatbot |
| Quando roda | Só no **primeiro contato** (número que ainda não é contato do workspace) |
| Contato novo | Com chatbot ligado, número desconhecido **vira contato** (hoje é descartado nesses números). Sem chatbot, nada muda |
| Formato | Formulário de etapas em ordem (não é o canvas de workflow). Evoluir pro canvas só se surgir demanda |
| Fim | Mensagem final + conversa aberta pra equipe |
| Humano | Mensagem manual da equipe **interrompe** o bot na hora |
| Etiquetas | Opção de menu vira **etiqueta** automaticamente (editável); pergunta aberta pode salvar a resposta como etiqueta |

## 1. Configuração (Configurações → card do número → "Mensagens iniciais (chatbot)")

Liga/desliga + lista ordenada de etapas + mensagem final. `{{primeiro_nome}}` e `{{campo:chave}}`
disponíveis nos textos.

Tipos de etapa:

- **Pergunta aberta**: texto; campo de destino (campo personalizado, ou "nome"/"email" do contato);
  opção "salvar resposta também como etiqueta".
- **Menu**: texto de abertura; opções. Cada opção: rótulo (o que o lead vê), etiqueta (padrão = rótulo),
  valor opcional num campo, etapa opcional do Pipeline (só avança/revive via `canAdvanceStage`). O texto
  enviado é montado com 1️⃣ 2️⃣ 3️⃣… a partir das opções.
- **Mensagem**: só envia, não espera resposta.

Modelos prontos pra começar: "Luchini — cidade + interesse" (as duas mensagens deles) e um genérico
("boas-vindas + menu de setores"). Sem exemplo de cliente na UI além do nome do modelo.

## 2. Dados (migration `0077_chatbot.sql`)

- `whatsapp_instances.chatbot jsonb` — config acima (`enabled`, `steps[]`, `finalMessage`).
- `chatbot_sessions`: `id`, `workspace_id`, `instance_id`, `contact_id` (unique por instância),
  `step_index`, `retries`, `status` (`ativo` | `concluido` | `interrompido`), `answers jsonb`,
  `started_at`, `updated_at`. RLS de leitura por workspace; escrita só pelo servidor.

## 3. Comportamento

- **Início**: número novo escreve → cria contato (nome do perfil do WhatsApp), cria sessão, envia a
  primeira etapa e as etapas "mensagem" seguintes até a próxima pergunta. A mensagem do lead é registrada
  mas não conta como resposta.
- **Pergunta aberta**: campo de lista → casa com as opções ignorando acento/caixa (`canonicalizeValue`);
  valor fora da lista é gravado como veio e **adicionado às opções** (igual à importação). Campo de
  cidade do workspace (`city_field_key`) → roda o **roteamento por território** (nunca reatribui dono).
- **Menu**: aceita "1", "1️⃣", "opção 1" ou o rótulo (normalizado). Inválida → reenvia com "Não entendi 😅
  responde com o número da opção" (1 vez); 2ª inválida → encerra o bot e passa pra equipe.
- **Mídia no lugar de texto**: pede pra escrever (1 vez); na 2ª pula a etapa.
- **Fim**: mensagem final; etapa `interessado` (mesma regra atual de "respondeu"); observação no lead com
  as respostas; ticket de atendimento `aberto`.
- **Interrupção**: mensagem manual da equipe (`sendInstanceMessage`/`sendInstanceMedia`) → sessão
  `interrompido`. Opt-out (SAIR/PARAR) → para + `opt_out_whatsapp` (regra atual).
- Mensagens do bot gravadas em `messages` (`role: assistant`, `agent_id: null`) — aparecem em Conversas.
  Intervalo de 1–2s entre mensagens seguidas.
- Avanço de etapa da sessão com update condicionado ao `step_index` esperado — duas mensagens seguidas
  do lead não pulam etapa duas vezes.
- Canais: Evolution, 360dialog e Meta (mesma escolha de canal do envio manual). Na API oficial cada
  mensagem do bot é mensagem de serviço (cobrada por mensagem a partir de 01/10/2026).

## 4. Testes

- Automáticos (puros): leitura da resposta de menu, casamento de valor de lista, montagem do texto do
  menu, próxima etapa (mensagem encadeada, retry, pular).
- Real: número de teste com chatbot ligado — primeiro contato, cidade na lista e fora dela, menu válido e
  inválido, humano interrompendo, opt-out.
