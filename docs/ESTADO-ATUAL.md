# Estado atual — retomada de contexto

Última atualização: **2026-09-08**. Leia isto antes de mexer em qualquer coisa.

---

## ⚠️ O que está pendente AGORA (comece por aqui)

**Nada com risco de derrubar cliente.** O bloco 4 subiu em 2026-09-08 (`5a84d0c`), com a migration
`0070` aplicada e conferida no banco antes do push.

O que sobrou é **teste, não código**: a passagem de bastão está em produção mas **desligada em todos
os agentes** e **nunca foi testada em conversa real**. Antes de ligar em qualquer cliente, criar um
segundo agente num número de teste e passar um lead de verdade — principalmente o modo `numero`, que
é o único que envia mensagem por conta própria. Ver "Teste que ainda não foi feito" no fim.

Depois disso, o próximo passo de código é o **redesign visual do Pipeline**, que fecha o bloco 3.

---

## Como trabalhar neste projeto (regras do dono)

- **Deploy só com "pode subir" explícito.** Nunca commitar sem pedir. Build local (`npx tsc --noEmit`
  + `npx next build`) validado antes de todo push.
- **Migrations são entregues como SQL pro usuário rodar à mão no Supabase** (não há acesso Postgres
  direto; só REST via service role key, que faz DML mas não DDL). Sempre **conferir no banco** que
  rodou antes de subir — não aceitar "rodei" sem verificar.
  - Para conferir, ler `.env.local` e usar `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
    contra `/rest/v1/`.
- **Nada de exemplo de cliente específico** na UI nem em comentário de código. Placeholder e texto de
  ajuda são genéricos ("Opção A/B/C", "ex.: Matriz, Filial Centro"). O produto não é de um segmento só.
- **O que é opcional vira configuração, não regra.** A plataforma é um CRM; o agente de IA é uma
  função dentro dela. Nada do agente pode ser obrigatório, e nada do CRM pode depender do agente existir.
- **Design é gosto do dono** — mostrar e iterar antes de dar como fechado. Usar as skills `/forge` e
  `/ui-ux-pro-max`. Projeto já tem identidade travada (gradiente vermelho, tokens semânticos em
  `globals.css`): preservar, não gerar direção nova.

### Armadilhas que já custaram tempo aqui

- **PostgREST recusa insert em massa quando os objetos do lote não têm exatamente as MESMAS chaves**
  (`All object keys must match`). Nada de omitir campo condicionalmente numa lista.
- **Nunca montar `.in()` com centenas de ids**: a URL estoura o limite do servidor e a chamada falha
  **calada**. Já causou "/conversas vazia" com 800+ mensagens no banco. Paginar ou filtrar por
  `workspace_id`.
- **O servidor corta qualquer resposta em 1000 linhas**, ignorando `.limit()` maior. Paginar de
  verdade com `.range()` e `.order()` estável (sem ordem definida o PostgREST embaralha entre páginas).
- **Nunca nomear uma const de `URL`** em script Node: sombreia o construtor global e o `fetch` quebra.
- Heredoc de bash quebra com JSX/aspas. Escrever arquivo com a ferramenta Write e concatenar, ou usar
  Python com heredoc `<<'PY'`.
- Backslashes somem no shell. Para gerar `̀` em arquivo, montar com `chr(92)` ou usar a
  ferramenta Edit.

---

## Decisões de arquitetura que NÃO devem ser reabertas

1. **`contacts.stage` (os 7 sinais fixos) é a verdade semântica.** É o que o agente classifica, o que
   as métricas somam, o que o funil da Visão geral desenha e o que os workflows filtram. Funil
   personalizado é só vocabulário + ordenação por cima: cada `pipeline_stages.signal` declara qual dos
   7 sinais aquela etapa representa. **Foi isso que permitiu multi-funil sem tocar em métricas,
   Visão geral nem workflows.**
2. **Vendedores/gerentes não têm login.** `team_members` é cadastro puro. `contacts.team_member_id`
   (dono do lead na rede do cliente) é conceito SEPARADO de `contacts.responsible_user_id` (conta que
   opera a plataforma). Os dois coexistem de propósito.
3. **Um lead vive em um funil por vez.** Trocar de funil é mover, não duplicar. Não recriar a tabela
   de negócios/deals — ela foi removida em ago/2026 por duplicar o Pipeline sem uso real.
4. **O agente emite as 7 palavras fixas** (vocabulário onde ele erra menos) e a plataforma traduz pra
   etapa do funil do cliente via `stageForSignal()`. Não fazer o agente aprender vocabulário por cliente.
5. **Na passagem de bastão, só o PAPEL troca** (prompt, config, provedor). Histórico, mídia, base de
   conhecimento e custo continuam no agente do número — é uma conversa só, numa caixa de entrada só.
   Trocar o histórico junto faria o Closer assumir sem enxergar o que o SDR levantou.

---

## O que já está EM PRODUÇÃO

Commits, do mais antigo pro mais novo:

| Commit | O que entregou | Migration |
|---|---|---|
| `6b9eef5` | Campos do lead com esquema (`custom_field_defs`), filiais e equipe (`branches`, `team_members`) | 0063, 0064 |
| `542bc86` | Motivo de perda + relatórios de lead em `/metricas` | 0065 |
| `b72aebe` | Importador com de/para de colunas + roteamento por território | 0066 |
| `c57d6f8` | Agente ↔ campos do CRM; sidebar agrupada/recolhível; funções opcionais por workspace | 0067 |
| `2cb76cc` | Multi-funil (`pipelines`, `pipeline_stages`) | 0068 |
| `e6d8135` | Ordenações e visão de lista no Pipeline | 0069 |
| `5a84d0c` | Passagem de bastão SDR → Closer entre agentes | 0070 |

Detalhes que importam:

- **Campos personalizados** (`custom_field_defs`): rótulo, tipo, opções fixas, obrigatório, coluna em
  Contatos, etiqueta no card. Valor continua em `contacts.custom_fields` jsonb. **Chave sem definição
  nunca é apagada ao salvar** — é o formato antigo mais o que o agente grava via `[[DADOS:]]`.
- **Agente ↔ campos**: o prompt ensina as opções válidas de cada lista; o `agent-turn` normaliza a
  grafia contra a definição real antes de gravar (`canonicalizeValue`), senão cada variação de caixa
  e acento vira uma categoria a mais no relatório.
- **`workspaces.hidden_pages`**: marca-se manualmente o que o cliente NÃO usa; some do menu e bloqueia
  por URL, pra todo mundo inclusive a agência. `ACCESS_TYPES` virou atalho que pré-marca as caixas.
- **`workspaces.ask_lost_reason`**: o diálogo de motivo de perda é opcional (estava imposto).
- **Territórios**: `matchMemberByName` casa apelido com nome completo (token + prefixo bidirecional +
  letra sozinha como inicial) e **devolve null no empate em vez de chutar** — mandar o lead pro
  vendedor errado é pior do que devolver a linha pra quem colou desambiguar.
- **Ordenações** em `src/lib/crm-sorting.ts` (estado de tela, não config do workspace). "Interações"
  usa a função agregada `contact_message_counts` (`security invoker`, respeita RLS). Se a função
  sumir, o Pipeline **não quebra**: só perde essa ordenação.
- **Passagem de bastão** (`src/lib/agent-handoff.ts`): `agents.handoff_to_agent_id/mode/signal/intro/
  notice` + `contacts.active_agent_id/handed_off_at`. Modo `papel` troca só o cérebro no mesmo número
  (o destino nem precisa de número próprio); modo `numero` faz o destino se apresentar pelo número
  dele e o antigo dar um aviso curto e parar. O gatilho compara por **posição** na ordem canônica de
  `contacts.stage`, não por igualdade, porque o agente pula etapas; ganho e perda não disparam. A
  atribuição é gravada **antes** do envio da apresentação, senão falha de envio deixa o lead em limbo.
  **Desligado por padrão**: sem `handoff_to_agent_id`, nenhuma linha nova executa.

---

## Roadmap

| | Bloco | Situação |
|---|---|---|
| ✅ | 1 — Agente ↔ campos personalizados | em produção |
| ✅ | 2 — Sidebar + funções opcionais por workspace | em produção |
| 🟡 | 3 — Multi-funil, ordenações, visão de lista | em produção; **falta só o redesign visual do Pipeline** |
| ✅ | 4 — SDR ↔ Closer | em produção (`5a84d0c`); **desligado em todos os agentes, falta teste real** |
| ⬜ | 5 — Facebook Lead Ads | não começado |

### Bloco 5 — Facebook Lead Ads (não começado)

Formulário de lead da Meta cai direto em Contatos como "não abordado", filtrável por campanha.
**Depende de coisa fora do código**: o app da AutoMax precisa da permissão **`leads_retrieval`**
aprovada no App Review e da assinatura do webhook `leadgen` nas páginas do cliente. A revisão da Meta
demora semanas — o pedido deveria ser aberto em paralelo, não quando o bloco começar.

### Pendências que dependem do dono (não são código)

1. **Chave do 21st.dev** — o MCP `magic` não conecta (`Not authenticated - your API key is missing or
   was reset`). Chave nova em https://21st.dev/mcp. Sem ela, o redesign sai sem o catálogo de
   componentes.
2. **Permissão `leads_retrieval` da Meta** — pré-requisito do bloco 5, ver acima.
3. **Ninguém do cliente Luchini Tratores tem login.** O workspace (`8cd60e8e-55ae-4c87-b69a-795e7d34f695`)
   está populado (578 leads, 55 pessoas, 5 filiais, 200 territórios) mas sem nenhum `workspace_members`.
   Criar o acesso já no formato novo (marcar funções em vez de escolher plano). Palpite pelo uso: Campanhas
   e Agentes de IA desligados, porque a operação deles é CRM manual.

### Teste que ainda não foi feito

O bloco 4 mexe no motor que atende **cliente real** (Hanoi, TB Rio, ENACAL, Valec) e **já está em
produção desde 2026-09-08**. Está aditivo e desligado — conferido no banco no dia do deploy: 8
agentes, **0 com `handoff_to_agent_id`**, 0 contatos com `active_agent_id`. Enquanto ficar assim,
nenhuma linha nova executa e o atendimento se comporta exatamente como antes. Mas
**conversa real nunca foi testada daqui**. Antes de ligar em qualquer cliente: criar um segundo
agente num número de teste e passar por um lead de verdade, principalmente o modo "outro número",
que é o único que envia mensagem sozinho.
