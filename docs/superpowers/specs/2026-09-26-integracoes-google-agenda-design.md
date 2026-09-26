# Integrações — Google Agenda do closer (SDR marca reunião)

Data: 2026-09-26 · Status: aprovado em conversa, aguardando revisão do documento

## Objetivo

O agente SDR, ao qualificar um lead, marca a reunião direto no Google Agenda de um closer humano,
com link do Meet, sem sair do WhatsApp. Entra por uma página nova, **Integrações**, que nasce com
essa integração e fica pronta pra receber outras.

Quando não houver closer com agenda conectada (ex.: vendedor que vende só pelo WhatsApp), o agente
segue exatamente como hoje: sinaliza pra um humano assumir.

## Decisões travadas

| Tema | Decisão |
|---|---|
| Quem é o closer | Pessoa cadastrada em **Equipe** (`team_members`), com ou sem login na plataforma |
| Como conecta | Botão "Conectar agora" na página **ou** link assinado de 7 dias enviado ao closer |
| Qual closer recebe | Dono do lead (`contacts.team_member_id`) se estiver na lista do agente e conectado; senão **rodízio** (quem recebeu reunião há mais tempo) |
| Formato | Sempre **Google Meet** |
| Depois de marcar | O SDR continua na conversa só para assuntos da reunião (confirmar, remarcar, cancelar) |
| Integração | Direta com a Google Calendar API via OAuth (sem intermediário tipo Cal.com/Calendly) |
| Padrão | **Desligado.** Nenhum agente existente muda até alguém ligar o agendamento nele |

## Fora de escopo (fica pra depois)

- Lembrete automático pro lead antes da reunião.
- Aviso pro closer pelo WhatsApp (ele é avisado pelo próprio convite do Google Agenda).
- Outras integrações (a página só mostra cards "em breve").
- Qualquer mudança na passagem de bastão entre agentes (`agent-handoff.ts`) — são features
  independentes; marcar reunião não troca de agente.

---

## 1. Dados (migration `0075_calendar_integration.sql`)

### `calendar_connections`

Uma por pessoa da Equipe.

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid fk → workspaces, cascade | |
| `team_member_id` | uuid fk → team_members, cascade, **unique** | |
| `provider` | text, default `'google'` | preparado pra outros provedores |
| `account_email` | text | e-mail da conta Google conectada |
| `refresh_token_enc` | text | **criptografado** (AES-256-GCM, chave `CALENDAR_TOKEN_KEY` só na Vercel) |
| `status` | text | `conectado` \| `reconectar` |
| `last_error` | text null | último erro de autorização, pra exibir na página |
| `connected_at` | timestamptz | |

RLS: membros do workspace podem **ler só as colunas não sensíveis** via view
`calendar_connections_public` (sem `refresh_token_enc`). Escrita e leitura do token apenas pelo
service role no servidor.

### `meetings`

| Coluna | Tipo | Observação |
|---|---|---|
| `id` | uuid pk | |
| `workspace_id` | uuid fk | |
| `contact_id` | uuid fk → contacts, cascade | |
| `agent_id` | uuid fk → agents, set null | |
| `team_member_id` | uuid fk → team_members, set null | closer |
| `google_event_id` | text | |
| `starts_at` / `ends_at` | timestamptz | |
| `meet_link` | text | |
| `status` | text | `marcada` \| `remarcada` \| `cancelada` |
| `created_at` / `updated_at` | timestamptz | |

Índice `(team_member_id, created_at desc)` para o rodízio e `(contact_id, status)` para achar a
reunião ativa do lead.

### Configuração no agente

Novo bloco `scheduling` dentro de `agents.config` (jsonb já existente, normalizado em
`normalizeAgentConfig`), sem migration:

```ts
scheduling: {
  enabled: boolean;          // padrão false
  closerIds: string[];       // team_member ids que participam
  durationMin: number;       // padrão 30
  minNoticeHours: number;    // padrão 2
  daysAhead: number;         // padrão 7
  // janela de horário = horário de atendimento do agente (config.hours), sem campo novo
}
```

---

## 2. Página Integrações (`/integracoes`)

- Item novo na sidebar, grupo **Automação**, ocultável por `workspaces.hidden_pages` como as demais.
- Seção **Google Agenda dos closers**: lista `team_members` ativos com status
  (Conectado · e-mail / Desconectado / Precisa reconectar) e ações:
  - **Conectar agora** → inicia o OAuth na própria sessão.
  - **Copiar link de conexão** → gera URL `/conectar-agenda/<token>`; token assinado (HMAC com
    `CALENDAR_TOKEN_KEY`) contendo `workspace_id`, `team_member_id` e expiração de 7 dias.
  - **Desconectar** → revoga o token no Google e apaga a conexão.
- Cards "em breve" para futuras integrações (sem ação).

### Fluxo OAuth

1. `/conectar-agenda/<token>` (pública) valida a assinatura e a expiração, mostra "Conectar a agenda
   de {nome} à {empresa}" e redireciona ao Google com `state` assinado (mesmo conteúdo do token).
2. Escopos: `openid email` (só pra exibir qual conta foi conectada),
   `https://www.googleapis.com/auth/calendar.events` e
   `https://www.googleapis.com/auth/calendar.freebusy`; `access_type=offline`, `prompt=consent`
   (garante refresh token).
3. `/api/integrations/google/callback` valida o `state`, troca o code por tokens, lê o e-mail da
   conta, grava `calendar_connections` (upsert por `team_member_id`) com `status='conectado'`.
4. Página final: "Agenda conectada" (link público) ou volta pra `/integracoes` (sessão logada).

Access token não é persistido: cada uso troca o refresh token por um access token novo (volume
baixo, simplicidade maior). `invalid_grant` na troca ⇒ `status='reconectar'` + `last_error`.

---

## 3. Agente na conversa

### Quando entra em ação

`scheduling.enabled` **e** pelo menos um closer de `closerIds` com conexão `conectado`. Caso
contrário as ferramentas não são oferecidas ao modelo e nada muda.

### Escolha do closer (`pickCloser`)

1. Se o lead tem `team_member_id` presente em `closerIds` e conectado → ele.
2. Senão, rodízio entre os elegíveis: o de `meetings.created_at` mais antigo (quem nunca recebeu
   vem primeiro).
3. Se o lead não tinha dono, grava o closer escolhido em `contacts.team_member_id`. Lead com dono
   **nunca** é reatribuído.

Se o lead já tem reunião ativa (`marcada`/`remarcada`), o closer é o dessa reunião.

### Ferramentas (Anthropic tool use; convertidas pro Gemini por `toGeminiTool`)

| Ferramenta | Entrada | Efeito |
|---|---|---|
| `ver_horarios_disponiveis` | — | freebusy do closer na janela; devolve 3–4 opções espalhadas pelos próximos `daysAhead` dias, respeitando `durationMin`, `minNoticeHours` e `config.hours`, em horário de Brasília |
| `marcar_reuniao` | `inicio` (ISO), `email` opcional | revalida o horário (freebusy de novo); cria evento com Meet; grava `meetings`; efeitos pós-marcação |
| `remarcar_reuniao` | `novo_inicio` | revalida; atualiza o evento; `status='remarcada'` |
| `cancelar_reuniao` | — | cancela o evento (notifica convidados); `status='cancelada'` |

O cálculo de horários é função pura (`computeSlots(busy, janela, regras, agora)`), testável sem
Google.

### Bloco de prompt (injetado só quando ativo)

Quando o lead estiver qualificado segundo o objetivo do SDR, ofereça horários **sempre** pela
ferramenta `ver_horarios_disponiveis`, nunca invente horário, confirme o escolhido antes de chamar
`marcar_reuniao`. Com reunião ativa, trate só de assuntos da reunião; remarque/cancele pelas
ferramentas.

### Evento no Google

- Agenda: a `primary` do closer (organizador).
- Título: `Reunião: {nome do lead}`.
- Meet: `conferenceData.createRequest` (`conferenceDataVersion=1`).
- Convidados: lead, se houver e-mail; `sendUpdates=all`.
- Descrição: campos coletados pelo SDR (`custom_fields` com rótulo), telefone e link
  `…/conversas?contact=<id>`.

### Pós-marcação

- Agente envia ao lead dia, hora e link do Meet.
- `stage` avança pra `encaminhamento` via `canAdvanceStage` (só avança).
- `contact_notes`: "Reunião marcada com {closer} em {dd/mm} às {hh:mm}" (idem remarcar/cancelar).
- Card do Pipeline: selo "Reunião dd/mm hh:mm" para reunião ativa futura.

---

## 4. Erros

| Situação | Comportamento |
|---|---|
| Google fora / erro de rede | ferramenta devolve erro; agente diz que vai confirmar os horários com o time; `flagged_reason` preenchido. Nunca confirma horário não gravado |
| `invalid_grant` (revogado/expirado) | conexão → `reconectar`; closer sai do rodízio; aviso na página |
| Horário ficou ocupado | ferramenta devolve "ocupado" + novas opções |
| Nenhum horário na janela | agente avisa e sinaliza humano (`flagged_reason`) |
| Nenhum closer conectado | ferramentas não são oferecidas; comportamento atual |

## 5. Segurança

- `refresh_token_enc` com AES-256-GCM; chave `CALENDAR_TOKEN_KEY` (32 bytes base64) só na Vercel.
  Nenhuma rota/tela devolve o token.
- Link de conexão e `state` do OAuth assinados com HMAC e expiração de 7 dias; ligados a um
  `team_member_id` e `workspace_id` específicos.
- Callback confere a assinatura do `state` antes de gravar qualquer coisa.
- Desconectar revoga no Google (`oauth2.googleapis.com/revoke`) e apaga a linha.

## 6. Testes

- Automáticos (lógica pura): `computeSlots` (antecedência, janela, fuso, dia sem horário, busy
  sobreposto), `pickCloser` (dono, rodízio, desconectado, reunião ativa), assinatura/expiração do
  token de conexão, criptografia ida-e-volta.
- Real, no workspace **Orbion**, com a conta Google do dono como closer: conectar (pelos dois
  caminhos), conversar com o agente pelo WhatsApp, marcar, remarcar, cancelar; conferir evento,
  Meet, convite e observações no lead.

## 7. Pré-requisitos fora do código (dono)

1. Google Cloud: ativar **Google Calendar API** e criar cliente OAuth (Web) — pode ser o mesmo
   projeto do login com Google. Redirect URI:
   `https://plataforma.disparo.studiov4carvalho.com.br/api/integrations/google/callback`.
2. Vercel: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `CALENDAR_TOKEN_KEY`.
3. Tela de consentimento OAuth com escopos sensíveis ⇒ **verificação do Google** (política de
   privacidade, domínio verificado, vídeo). Abrir em paralelo. Até aprovar: até 100 contas de teste,
   aviso de "app não verificado" e **refresh token expira em 7 dias** — serve pra piloto, não pra
   cliente em produção.
