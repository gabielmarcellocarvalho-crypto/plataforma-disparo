# Plano — Integrações / Google Agenda do closer

Spec: `docs/superpowers/specs/2026-09-26-integracoes-google-agenda-design.md`

Regras do projeto que valem pra todas as fases: build local (`npx tsc --noEmit` + `npx next build`)
antes de todo push; deploy só com "pode subir"; migration entregue como SQL pro dono rodar e
**conferida via REST antes do push**; nada de exemplo de cliente na UI; tudo desligado por padrão.

Chamadas ao Google via `fetch` direto nas APIs REST (sem o pacote `googleapis`, que é pesado e só
usaríamos 5 endpoints).

---

## Fase 0 — Executor de testes

- `npm i -D vitest`; script `"test": "vitest run"`; `vitest.config.ts` com alias `@` → `src`.
- Verificação: `npm test` roda (zero testes ainda passa).

## Fase 1 — Base: banco, criptografia e link assinado

Arquivos:
- `supabase/migrations/0075_calendar_integration.sql` — `calendar_connections`, `meetings`, índices,
  RLS (membro do workspace lê `meetings`; `calendar_connections` sem policy de select pra
  `authenticated`), view `calendar_connections_public` (sem `refresh_token_enc`, `security_invoker`
  com policy própria de leitura por workspace).
- `src/lib/calendar/crypto.ts` — `encryptToken` / `decryptToken` (AES-256-GCM, `CALENDAR_TOKEN_KEY`).
- `src/lib/calendar/connect-token.ts` — `signConnectToken({workspaceId, teamMemberId})` com
  expiração de 7 dias e `verifyConnectToken(token)` (HMAC-SHA256, comparação em tempo constante via
  `secure-compare.ts`).
- Testes: `crypto.test.ts` (ida e volta, chave errada falha), `connect-token.test.ts` (válido,
  expirado, adulterado, outro segredo).

Verificação: `npm test` verde; SQL entregue ao dono; conferir via REST que as tabelas existem.

## Fase 2 — Conexão OAuth

Arquivos:
- `src/lib/calendar/google-oauth.ts` — `buildAuthUrl(state)`, `exchangeCode(code)`,
  `refreshAccessToken(refreshToken)` (em `invalid_grant` lança `CalendarAuthError`),
  `revokeToken(token)`, `fetchAccountEmail(idToken|accessToken)`.
- `src/app/conectar-agenda/[token]/page.tsx` — página **pública**: valida token, mostra "Conectar
  a agenda de {nome}" e botão pro Google; token inválido/expirado ⇒ mensagem clara.
- `src/app/api/integrations/google/start/route.ts` — sessão logada, recebe `teamMemberId`, confere
  que a pessoa é do workspace ativo, gera `state` assinado e redireciona.
- `src/app/api/integrations/google/callback/route.ts` — valida `state`, troca code, grava
  `calendar_connections` (upsert por `team_member_id`, token criptografado, `status='conectado'`),
  redireciona pra `/integracoes?conectado=<id>` (logado) ou pra tela "Agenda conectada" (público).
- `src/lib/supabase/middleware.ts` — adicionar `/conectar-agenda` e
  `/api/integrations/google/callback` em `PUBLIC_PATHS`.
- `src/app/actions/integrations.ts` — `createConnectLink(teamMemberId)`,
  `disconnectCalendar(teamMemberId)` (revoga + apaga).

Verificação: com a conta do dono como teste no Google Cloud, conectar pelos dois caminhos em
`localhost:3100` e conferir a linha no banco com token cifrado.

## Fase 3 — Página Integrações

Arquivos:
- `src/app/(dashboard)/integracoes/page.tsx` + `src/components/integrations-calendar.tsx` —
  lista `team_members` ativos + status da view pública; ações Conectar agora / Copiar link /
  Desconectar; texto de ajuda do "Marque aqui"; contagem de "Marque aqui" livres nos próximos 7 dias
  por closer conectado (chamada ao Google no servidor, em paralelo, com timeout curto e "—" em
  falha); cards "em breve".
- `src/components/sidebar.tsx` — item `/integracoes` no grupo Automação.
- `src/lib/access-types.ts` — `/integracoes` em `PAGE_CATALOG` e nos planos que já têm `/agentes`
  (SDR, Closer, SDR LIGHT, Ultra).

Verificação: página renderiza com e sem closers; ocultar pelo `hidden_pages` bloqueia por URL.

## Fase 4 — Motor de agendamento (sem o agente ainda)

Arquivos:
- `src/lib/calendar/google-events.ts` — `listEvents(accessToken, from, to)` (`singleEvents=true`,
  `orderBy=startTime`, paginado), `getEvent`, `patchEvent(id, body, etag)` (`If-Match`,
  `conferenceDataVersion=1`, `sendUpdates=all`; 412 ⇒ `SlotTakenError`), `deleteEvent`,
  `insertEvent`.
- `src/lib/calendar/slots.ts` — **puro**: `isSlotTitle(title, slotTitle)` (sem caixa/acento),
  `pickSlots(events, {slotTitle, minNoticeHours, daysAhead, now, max: 4})` espalhando por dias.
- `src/lib/calendar/closer.ts` — **puro**: `pickCloser({ownerId, closerIds, connected, lastMeetingAt,
  hasSlots, activeMeetingCloserId})`.
- `src/lib/scheduling.ts` — orquestra com banco + Google: `getSchedulingContext(agent, contact)`,
  `offerSlots`, `bookSlot`, `rescheduleMeeting`, `cancelMeeting`. Efeitos de marcar: `meetings`,
  `contact_notes`, `stage` via `canAdvanceStage` → `encaminhamento`, `team_member_id` se vazio.
  "Devolver a Marque aqui": PATCH removendo convidados/descrição/conferência; se a API recusar
  remover a conferência, `deleteEvent` + `insertEvent` "Marque aqui" no mesmo horário (confirmar
  na primeira execução real e remover o caminho não usado).
  `CalendarAuthError` ⇒ conexão `reconectar` + `last_error`.
- Testes: `slots.test.ts`, `closer.test.ts` (casos listados na spec §6).

Verificação: testes verdes; script de scratchpad contra a agenda de teste do dono lista, marca,
remarca e cancela um "Marque aqui" real.

## Fase 5 — Agente

Arquivos:
- `src/lib/agent-prompt.ts` — `scheduling` em `AgentConfig` + `normalizeScheduling` (padrões da spec).
- `src/components/agent-scheduling-form.tsx` + `agent-edit-view.tsx` — seção "Agendamento de
  reunião": liga/desliga, closers (só pessoas da Equipe; mostra quem está conectado), nome do
  evento, antecedência, dias à frente. Salva via `updateAgentConfig` existente.
- `src/lib/agent-turn.ts` — `buildAgentTools` passa a juntar ferramentas de mídia (se houver) e de
  agenda (se `getSchedulingContext` ativo); executor despacha por nome. Bloco de instrução de
  agendamento anexado ao system prompt **em tempo de execução** (não no `system_prompt` salvo),
  incluindo a reunião ativa quando existir. Erro de agenda ⇒ `flagged_reason`.
- Gemini: conferir que `toGeminiTool` cobre os schemas novos (parâmetros string simples).

Verificação: conversa real no WhatsApp com agente de teste da Orbion (Claude e Gemini): oferecer,
marcar, remarcar, cancelar; agente sem agendamento ligado se comporta igual antes.

## Fase 6 — Pipeline

- `src/app/(dashboard)/crm/page.tsx` — buscar reuniões ativas futuras do workspace (por
  `workspace_id`, paginado — nada de `.in()` grande).
- `src/components/crm-board.tsx` — selo "Reunião dd/mm hh:mm" no card e na lista.

## Fase 7 — Entrega

- Dono: Google Cloud (Calendar API, cliente OAuth, redirect URI, conta de teste), envs na Vercel
  (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY`), rodar migration.
- Deploy com "pode subir"; agendamento desligado em todos os agentes.
- Teste real completo na Orbion (spec §6).
- Abrir a verificação do app no Google (vídeo gravado a partir do teste real).
- Atualizar `docs/ESTADO-ATUAL.md`.
