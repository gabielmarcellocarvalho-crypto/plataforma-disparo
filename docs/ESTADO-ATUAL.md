# Estado atual — retomada de contexto

Última atualização: **2026-09-05**. Leia isto antes de mexer em qualquer coisa.

---

## ⚠️ O que está pendente AGORA (comece por aqui)

**Bloco 4 (passagem de bastão SDR → Closer) está escrito, com build e lint limpos, mas NÃO
commitado e a migration NÃO foi aplicada.**

Arquivos modificados sem commit:

```
 M src/app/(dashboard)/agentes/[id]/page.tsx
 M src/app/actions/agents.ts
 M src/app/api/webhook/dialog360/route.ts
 M src/app/api/webhook/whatsapp/route.ts
 M src/components/agent-edit-view.tsx
 M src/lib/agent-turn.ts
?? src/components/agent-handoff-form.tsx
?? src/lib/agent-handoff.ts
?? supabase/migrations/0070_agent_handoff.sql
```

**A migration `0070_agent_handoff.sql` precisa rodar ANTES do deploy.** Os dois webhooks passaram a
selecionar `AGENT_COLUMNS`, que inclui as colunas novas (`handoff_to_agent_id`, `handoff_mode`,
`handoff_signal`, `handoff_intro`, `handoff_notice`) — sem elas no banco, **o select falha e o agente
para de responder em produção**. Este é o único ponto desta rodada com risco de derrubar atendimento
de cliente real.

Ordem correta: rodar a migration → conferir no banco → commit → push.

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

---

## Roadmap

| | Bloco | Situação |
|---|---|---|
| ✅ | 1 — Agente ↔ campos personalizados | em produção |
| ✅ | 2 — Sidebar + funções opcionais por workspace | em produção |
| 🟡 | 3 — Multi-funil, ordenações, visão de lista | em produção; **falta só o redesign visual do Pipeline** |
| 🟡 | 4 — SDR ↔ Closer | **código pronto, não commitado, migration 0070 não aplicada** |
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

O bloco 4 mexe no motor que atende **cliente real** (Hanoi, TB Rio, ENACAL, Valec). Está aditivo e
desligado por padrão — sem `handoff_to_agent_id` preenchido, nenhuma linha nova executa. Mas
**conversa real nunca foi testada daqui**. Antes de ligar em qualquer cliente: criar um segundo
agente num número de teste e passar por um lead de verdade, principalmente o modo "outro número",
que é o único que envia mensagem sozinho.
