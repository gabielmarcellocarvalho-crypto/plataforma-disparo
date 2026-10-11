# Auditoria de Blindagem — AutomaX / Plataforma-Disparo (2ª rodada)

Data: 2026-10-10 · Commit auditado: `1211828` (branch `master`)
Escopo: repositório `C:\Projetos-Dev\Plataforma-Disparo` + sondagens **somente leitura** na produção (`www.automax.tec.br`) e contagens agregadas no banco.
Método: leitura de código (rotas, server actions, libs, 85 migrations), `git log -G` no histórico completo (236 commits), `npm audit`, `curl` sem credenciais contra produção. **Nenhum código foi alterado nesta rodada.** Nenhum dado de cliente foi lido além de contagens.
Versão anterior (29/08/2026, nota 3/10, 13 achados): preservada em `docs/SECURITY_AUDIT_2026-08-29.md`.

Convenções: **NÃO VERIFICADO** = depende de painel externo (Vercel/Supabase/VPS) que não está no repositório. **A CONFIRMAR** = suspeita sem prova; o teste que resolve está descrito no achado.

---

## 1. Mapa da aplicação

| Item | Estado atual | Evidência |
|---|---|---|
| Framework | Next.js **16.2.12** (App Router), React 19.2.4, TypeScript, Tailwind v4 | `package.json:29` |
| Hospedagem | Vercel (Fluid Compute, duração máx. 300 s, plano pago). 1 cron nativo (`/api/cron/followups`, diário 15:00 UTC) | `vercel.json:2-4` |
| VPS (Hostinger) | Evolution API (WhatsApp não oficial/Baileys) + crontab que chama `/api/cron/dispatch-campaigns` a cada minuto | `src/app/api/cron/dispatch-campaigns/route.ts:12-17` |
| Banco / Auth / Storage | Supabase (Postgres + PostgREST + Auth + Storage), região SP, plano pago. **Sem ORM e sem SQL cru**: tudo via `@supabase/supabase-js` | `src/lib/supabase/*.ts` |
| Acesso ao banco | 3 clientes: `server.ts` (anon + sessão, **RLS vale**), `client.ts` (navegador, **RLS vale**), `admin.ts` (service role, **ignora RLS**; só em servidor) | `src/lib/supabase/` |
| Front ↔ back | (1) **Server Actions** (149 funções exportadas em 22 arquivos) = canal principal de mutação; (2) Server Components buscam direto no Supabase com a sessão; (3) navegador também fala com o Supabase (anon key + RLS) | `src/app/actions/*.ts`, `src/app/login/actions.ts` |
| Roteamento / sessão | `src/proxy.ts` → `updateSession()` redireciona para `/login` quem não tem sessão e não está em `PUBLIC_PATHS` | `src/proxy.ts:22-41`, `src/lib/supabase/middleware.ts:19-40,58-65` |
| Papéis | `cliente` (1 workspace, páginas limitadas por `access_type`/`hidden_pages`), `colaborador` (escopado a workspaces via `workspace_members`), `developer` (todos os workspaces). `is_agency_admin()` = `developer` | `supabase/migrations/0059_developer_role.sql:23-29` |
| Isolamento multi-tenant | RLS em **todas as 45 tabelas** criadas nas migrations (verificado: 0 sem `enable row level security`; 4 delas, de `deals`, foram removidas na 0058); política padrão `has_workspace_access(workspace_id)` | migrations `0001`–`0085` |
| Rotas de API (15 handlers) | webhooks: `webhook/whatsapp`, `webhook/dialog360` (também recebe Meta Cloud); `integrations/facebook/{start,callback,webhook}`; `integrations/google/{start,callback}`; crons: `cron/{automations,dispatch-campaigns,followups}`; públicas por token: `v1/leads`, `workflows/webhook/[token]`, `e/[token]`, `unsubscribe`; `auth/callback` | `find src/app -name route.ts` |
| Núcleo de IA | `runAgentTurn` (`src/lib/agent-turn.ts`), chamado pelos 2 webhooks de WhatsApp → Anthropic/Gemini | `agent-turn.ts` |
| Segredos de integração | Tokens de Google Agenda, Facebook e Nuvemshop cifrados com **AES-256-GCM** (`CALENDAR_TOKEN_KEY`), tabelas com RLS ligada **e sem nenhuma policy** | `src/lib/calendar/crypto.ts:12-28`, `0075:24-26`, `0082:27-29`, `0078:17` |
| Variáveis de ambiente | Só na Vercel / `.env.local` (fora do git). `NEXT_PUBLIC_*` usadas: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `META_APP_ID`, `META_CONFIG_ID` (todas públicas por natureza) | `grep NEXT_PUBLIC` |
| CI/CD | **Não há** `.github/` nem pipeline. Push em `master` → deploy automático na Vercel | `ls .github` (inexistente) |
| Observabilidade | **Não há** Sentry/APM/health check. Logs = `console.*` na Vercel | `package.json`, `find src -iname "*health*"` |

---

## 2. Resumo executivo

**Nota: 6,5 / 10** (era 3 / 10 em agosto).

**Esta aplicação ESTÁ pronta para produção no porte atual** (12 workspaces, ~10 mil contatos, ~240 mensagens/dia), **porque** os dois achados críticos de agosto foram corrigidos e verificados no código (escalada de privilégio em `profiles` bloqueada por trigger, `supabase/migrations/0044_block_profile_privilege_escalation.sql`; teto de custo de IA implementado em `src/lib/agent-turn.ts:423-440`), toda tabela tem RLS, não há SQL cru nem `dangerouslySetInnerHTML`/`eval`, não há segredo no histórico do git, os webhooks/crons/chaves de API respondem 401 sem credencial (testado em produção) e os tokens de terceiros ficam cifrados e fora do alcance de qualquer usuário logado. **Ela NÃO está pronta para escalar ou ser vendida em volume** sem fechar os 6 achados ALTOS abaixo: dependência `next` com 8 avisos de segurança, webhook da Meta sem assinatura (só um segredo global na URL), o teto de custo de IA **desligado em todos os 12 workspaces**, ausência total de monitoramento/alerta, rate limit que não vale entre instâncias e backup nunca testado.

**Não há achado CRÍTICO confirmado nesta rodada** (nenhuma exploração remota sem autenticação, nenhum vazamento entre clientes).

Placar de agosto → hoje: dos 13 achados, **9 corrigidos**, 2 parciais (#4 rate limit, #6 prompt injection mitigado), 2 abertos (#8 bucket público, #11 magic bytes).

---

## 3. Status dos achados da rodada anterior

| # (ago) | Achado | Hoje | Evidência |
|---|---|---|---|
| 1 | RLS de `profiles` permitia virar colaborador | **Corrigido** | trigger `0044…sql:15-32`. Cobre `role` e `access_type`; `service_role` passa. **A CONFIRMAR em produção** com o teste do item 4.1 |
| 2 | Custo de IA sem teto | **Corrigido no código, inativo na prática** → ver ALTA-3 | `agent-turn.ts:423-440` |
| 3 | Server Actions de agentes sem checagem de papel | **Corrigido** | `requireStaff()` em 15 mutações de `agents.ts` (linhas 17-439) |
| 4 | Sem rate limit por IP | **Parcial** → ver MÉDIA-1 | `src/proxy.ts:8-20`, `src/lib/rate-limit.ts` |
| 5 | Sem headers de segurança | **Corrigido** (CSP mínima) | `next.config.ts:19-33`; confirmado no ar com `curl -I` |
| 6 | Sem defesa de prompt injection | **Mitigado** | `agent-prompt.ts:411` |
| 7 | Filtro PostgREST sem escape | **Corrigido** | `campaigns.ts:311-331`, `contatos/page.tsx:55-56` |
| 8 | Buckets públicos | **Aberto** → MÉDIA-6 | `conversation-media.ts:54` |
| 9 | Comparação de segredo não constante | **Corrigido** | `secure-compare.ts`; `secureEqual` em 10 pontos (webhooks, crons, Facebook, estados assinados) |
| 10 | Senha mínima 6 | **Corrigido** (10); MFA continua ausente → MÉDIA-5 | `auth.ts:47`, `access.ts:26` |
| 11 | Upload de conhecimento só por extensão | **Aberto** → BAIXA-3 | `agent-knowledge.ts:49` |
| 12 | Delay do agente x `maxDuration` | **Corrigido** (teto 120 s, `maxDuration` 300) | `agents.ts:417-422` |
| 13 | `.env.local.example` incompleto | **Aberto** (7 variáveis ausentes) → BAIXA-6 | ver BAIXA-6 |
| — | Idempotência de webhook | **Corrigido** (índice único `(workspace_id, external_id)`) | `0045_messages_external_id_dedup.sql:10` |

---

## 4. Tabela de achados (por severidade)

| # | Sev. | Achado | Arquivo:linha | Como explorar | Impacto | Correção |
|---|---|---|---|---|---|---|
| ALTA-1 | **ALTA** | `next@16.2.12` está na faixa afetada por 8 avisos (3 "críticos", 1 alto) | `package.json:29`; `npm audit` | Depende do aviso: RCE em `next/og` (**não usado**), RCE em Windows (**não aplicável**: Vercel é Linux), RCE/SSRF em otimização de imagem (a otimização roda na infra da Vercel e não há `remotePatterns`), cache poisoning SSG/ISR "self-hosted" (**não aplicável**). **Exploração real na Vercel: improvável (A CONFIRMAR)** | Se algum aviso se aplicar: execução remota sem autenticação | `npm i next@latest` (patch da série 16), rodar testes + build, subir. Esforço: pequeno. Risco de quebra: baixo (mesma série) |
| ALTA-2 | **ALTA** | Webhook da Meta/WhatsApp (e da Evolution) autentica só por **segredo global na URL** (`?secret=`); **não valida `X-Hub-Signature-256`**, ao contrário do webhook do Facebook Leads | `webhook/dialog360/route.ts:98-101`; `webhook/whatsapp/route.ts:110-113`; comparar com `integrations/facebook/webhook/route.ts:42-44` | Quem obtiver `WHATSAPP_WEBHOOK_SECRET` (aparece na URL em logs de acesso, painel da Evolution, configuração do app Meta) forja mensagem de **qualquer** número de **qualquer** workspace: dispara o agente (custo de LLM), cria leads, muda etapa | Injeção de conversas falsas e custo de IA; **o mesmo segredo vale para todos os clientes** | Validar HMAC SHA-256 do corpo bruto com `META_APP_SECRET` no ramo Meta (código do Facebook já faz). Manter o segredo só para a Evolution (que não assina) e **trocar o valor** depois. Esforço: pequeno/médio. Risco: ler o corpo cru antes de `req.json()` |
| ALTA-3 | **ALTA** | Teto de custo de IA **desligado**: nenhum dos 12 workspaces tem `monthly_cost_budget_brl`. Além disso a soma do mês é **truncada em 1.000 linhas** | `agent-turn.ts:427-441`; `cost-monitor.ts:60-73` (sem `.range`/paginação) | Número de agente é público; vários números de origem esgotam o rate limit por contato. Hoje o maior workspace tem 269 respostas/mês (abaixo de 1.000), então o truncamento ainda não mordeu | Custo de LLM sem limite real. Acima de 1.000 respostas/mês a soma sub-conta e o teto dispara tarde | (a) definir orçamento padrão (ex.: valor sugerido por plano) em todo workspace novo e agora nos 12; (b) somar no banco com função SQL (`sum` por `agent_id`) ou paginar com `fetchAllParallel`. Esforço: pequeno |
| ALTA-4 | **ALTA** | **Sem monitoramento, alerta nem health check**: ninguém é avisado se o webhook, o cron ou o banco falharem às 3 h | `package.json` (sem Sentry/APM); `find src -iname "*health*"` vazio; 22 arquivos só com `console.*` | Qualquer falha silenciosa (ex.: webhook descartando mensagem) só aparece por reclamação do cliente — já aconteceu duas vezes neste ano (GShop, Luchini) | Indisponibilidade não detectada = perda de lead e de receita | Sentry (erro) + `/api/health` que faz `select 1` no banco + monitor externo (UptimeRobot/Better Stack) com alerta no celular. Esforço: médio |
| ALTA-5 | **ALTA** (A CONFIRMAR) | Backup/restauração **nunca testados**; RPO/RTO desconhecidos | NÃO VERIFICADO (painel Supabase) | Erro humano (`delete` em massa, migration errada) ou falha do provedor | Perda de dados de todos os clientes. Plano Pro tem backup diário (7 dias) mas **PITR é opcional/pago** → RPO até 24 h | Conferir no painel: backup ativo, retenção, PITR. Fazer **um restore de teste** num projeto à parte e cronometrar. Esforço: pequeno |
| ALTA-6 | **ALTA** | Sem pipeline de CI e sem proteção de branch verificada: push em `master` vai direto para produção, sem teste/lint/build obrigatórios | ausência de `.github/`; branch protection NÃO VERIFICADO (CLI `gh` indisponível) | Um commit com erro derruba produção. Quem tem permissão de push publica | Regressão em produção | GitHub Actions com `tsc`, `vitest`, `next build`; proteger `master` (PR + checks). Esforço: pequeno |
| MÉDIA-1 | MÉDIA | Rate limit é **em memória, por instância**, e cobre só 4 prefixos + submit de login. Fora: `/esqueci-senha`, `/api/e`, `/api/unsubscribe`, `/api/integrations/*`, `/auth/callback` e todas as Server Actions de envio | `lib/rate-limit.ts:1-8,12`; `proxy.ts:8-20` | Distribuir a rajada entre instâncias da Vercel zera o contador; reset de senha sem limite próprio | Abuso de e-mail de reset, enumeração de tokens, custo | Rate limit compartilhado (Upstash Redis ou Vercel WAF) no `proxy.ts`; confirmar limites do Supabase Auth (NÃO VERIFICADO). Esforço: médio |
| MÉDIA-2 | MÉDIA | **Gate de plano/função só na aplicação**: RLS de `agents`, `whatsapp_instances`, `api_keys` etc. é `for all` para qualquer membro do workspace | `0006_agents.sql:18-19`; `0001_init.sql:175-176`; `0024_api_keys.sql:18-19` | Cliente logado chama a API REST do Supabase direto (anon key + própria sessão) e cria/edita `agents` (inclui prompt e canal) mesmo sem o plano. **A CONFIRMAR** com o teste do item 4.2 | Uso de IA/canal fora do plano contratado, no próprio tenant (não cruza clientes) | Policies separadas: `select` para membro, `insert/update/delete` só para `is_staff_of(workspace)`; ou trigger que valida `hidden_pages`/plano. Esforço: médio. **Risco de quebrar**: telas de cliente que gravam nessas tabelas (mapear antes) |
| MÉDIA-3 | MÉDIA | **IDOR de escrita entre workspaces** em `uploadWorkspaceLogo`: checa só "é staff" e usa service role com o `workspaceId` vindo do cliente | `actions/workspace.ts:118-146` | `colaborador` escopado ao cliente A chama a action com o `workspaceId` do cliente B e troca a logo/cor de marca (impacta e-mails de campanha de B) | Adulteração de identidade visual de outro cliente | Validar que o usuário tem acesso ao `workspaceId` (ex.: `select` pela RLS antes do `admin`). Auditar as outras actions staff com `admin` (as demais conferem pela RLS primeiro). Esforço: pequeno |
| MÉDIA-4 | MÉDIA | **SSRF cego** no passo `http_request` de workflows: busca qualquer URL, sem allowlist, e segue redirecionamento | `lib/workflow-engine.ts:493-500` | Membro do workspace monta workflow apontando para host interno/arbitrário; o status HTTP volta nos eventos do workflow. Corpo leva dados do lead | Varredura de rede a partir da Vercel; envio de PII para destino arbitrário (é a feature, mas sem freio) | Bloquear IP privado/loopback/link-local após resolver DNS, `redirect: "manual"`, limite de tamanho, só `https`. Esforço: pequeno |
| MÉDIA-5 | MÉDIA | **Sem MFA**; contas `developer` enxergam todos os clientes | `auth.ts` / `login/actions.ts` (só senha) | Phishing/credencial vazada de 1 developer = acesso a todos os workspaces | Comprometimento total | Habilitar TOTP do Supabase Auth e exigir para `developer`/`colaborador`. Esforço: médio (tela nova) |
| MÉDIA-6 | MÉDIA | Mídia de conversa em **bucket público** (acesso = imprevisibilidade do UUID) | `lib/conversation-media.ts:54`; `actions/conversations.ts:175` | URL vazada (log, print, encaminhamento) abre foto/áudio/PDF do cliente final sem login | Exposição de PII/voz | Bucket privado + URL assinada de curta duração gerada na hora de exibir/enviar. Esforço: médio (a Meta precisa baixar a mídia do envio: usar assinada com TTL de minutos) |
| MÉDIA-7 | MÉDIA | `dialog360_api_key` em **texto puro** e legível por qualquer membro do workspace | `0032_dialog360_channel.sql:8`; RLS `0001:175-176`; leitura em `conversations.ts:229` | Cliente lê a chave do próprio número via REST. Canal 360dialog saiu de uso | Baixo hoje; fica como dívida | Cifrar como os demais tokens ou apagar a coluna (canal descontinuado). Esforço: pequeno |
| MÉDIA-8 | MÉDIA | `dispatch-campaigns` **sem claim atômico**: duas execuções simultâneas enviam a mesma mensagem duas vezes | `cron/dispatch-campaigns/route.ts:92,103,424` (leitura de `next_dispatch_at` e escrita separadas) | Cron da VPS a cada minuto + execução lenta (>60 s) ou retry manual → lead recebe duplicado | Disparo duplicado a cliente final (reputação do número) | `update … where next_dispatch_at <= now() returning` como claim, antes de enviar. **Pré-requisito** para migrar o cron para a Vercel. Esforço: médio |
| MÉDIA-9 | MÉDIA | CSP mínima (só `frame-ancestors`); sem `script-src` | `next.config.ts:32` | Se surgir XSS, nada o contém. **Hoje não há sink de XSS** (0 ocorrências de `dangerouslySetInnerHTML`/`innerHTML`/`eval`) | Defesa em profundidade ausente | CSP em modo `Report-Only` primeiro, mapeando Meta SDK, Supabase Storage e imagens externas. Esforço: médio, **risco real de quebrar o Embedded Signup** se for direto para bloqueio |
| BAIXA-1 | BAIXA | Log de corpo de webhook com telefone e texto de cliente (LGPD) | `webhook/dialog360/route.ts:120` | Logs da Vercel guardam PII por até a retenção do plano | Dado pessoal em log | Logar só ids/contagens, ou mascarar telefone. Esforço: trivial |
| BAIXA-2 | BAIXA | Redirecionamento aberto condicionado: `next` vai direto para `new URL(next, origin)`; `//host` troca a origem | `auth/callback/route.ts:12,68` | Exige um `code` válido (PKCE): impraticável sem a sessão da vítima | Phishing pós-login | Aceitar só caminho relativo iniciado em `/` e sem `//`. Esforço: trivial |
| BAIXA-3 | BAIXA | Upload de conhecimento valida só a extensão do nome; `agent-media` sem limite de tamanho nem validação de tipo (extensão e content-type vêm do cliente; aceita `.html`/`.svg`) | `agent-knowledge.ts:49`; `actions/agents.ts:306-329` | Staff sobe arquivo HTML/SVG num bucket público (origem `supabase.co`, não a do app). Só `requireStaff` chega aqui | Baixo | Magic bytes, lista de tipos, teto de tamanho. Esforço: pequeno |
| BAIXA-4 | BAIXA | `unsubscribe` compara token com `===` e executa a ação por `GET` (scanner de e-mail pode descadastrar) | `lib/unsubscribe.ts:14`; `api/unsubscribe/route.ts` | Pré-visualização de link por antivírus/Gmail descadastra o contato | Descadastro indevido (token tem 96 bits, não é forjável) | `secureEqual`; confirmar por `POST` numa página intermediária. Esforço: pequeno |
| BAIXA-5 | BAIXA (A CONFIRMAR) | `redirectTo` do reset/OAuth usa o cabeçalho `Host` | `actions/auth.ts:7-10` | Só vale se a lista de "Redirect URLs" do Supabase tiver curinga. NÃO VERIFICADO | Link de reset apontando para domínio do atacante | Usar `APP_URL` fixo; revisar a lista no painel. Esforço: trivial |
| BAIXA-6 | BAIXA | `.env.local.example` sem 7 variáveis em uso (`CALENDAR_TOKEN_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `FACEBOOK_WEBHOOK_VERIFY_TOKEN`, `APP_URL`, `DIALOG360_BASE_URL`, `META_GRAPH_VERSION`) | `.env.local.example` | Deploy em ambiente novo sem `CALENDAR_TOKEN_KEY` quebra Agenda/Facebook/Nuvemshop | Risco operacional | Atualizar o arquivo. Esforço: trivial |
| BAIXA-7 | BAIXA | Webhook de workflow aceita `name`/`email`/corpo sem limite de tamanho | `workflows/webhook/[token]/route.ts:20-40` | POST com corpo grande grava lixo no contato | Poluição de dados | Limitar tamanhos. Esforço: trivial |
| BAIXA-8 | BAIXA | `client_secret` do app Meta vai na query string da troca de código | `lib/metacloud.ts:177` | Aparece em log de proxy da Meta/rede | Baixo | `POST` com corpo `application/x-www-form-urlencoded`. Esforço: trivial |
| INFO-1 | INFO | Chave de cifra única, sem versão/rotação (`CALENDAR_TOKEN_KEY`); service role única | `calendar/crypto.ts` | — | Rotação exigiria recifrar | Prefixo de versão no formato gravado, quando for conveniente |
| INFO-2 | INFO | Cookies de sessão do Supabase não são `HttpOnly` (padrão do SDK que o navegador também usa) | `lib/supabase/client.ts` | Só relevante se houver XSS (não há sink hoje) | — | Aceitar; reforça a importância da CSP |
| INFO-3 | INFO | **Nenhum achado** nos blocos: SQL/NoSQL/command/template injection; XSS; CORS (zero configuração, nenhum `Access-Control-*`); segredos no histórico do git; `.env`/`.git`/source maps expostos; service role no bundle do navegador; stack trace vazando | varreduras abaixo | — | — | Manter |

---

## 5. Detalhamento dos achados ALTOS

### ALTA-1 — `next` desatualizado (8 avisos)

`npm audit --omit=dev` lista para `next` (faixa `9.3.4-canary.0 – 16.3.7`): RCE em Windows, RCE em otimização de imagem com AVIF, RCE em `next/og`, SSRF em otimização de imagem, 2 de cache poisoning (SSG/ISR) e 2 de divulgação de informação. Os transitivos `postcss`, `sharp`, `source-map-js` e `baseline-browser-mapping` aparecem como "high"/"moderate" e vêm no mesmo `npm audit fix`.

Aplicabilidade: o projeto roda na Vercel (Linux, otimização de imagem da plataforma), não usa `next/og` nem `remotePatterns`, e usa `next/image` só em 2 componentes (`sidebar.tsx`, `auth-shell.tsx`). Por isso classifico como **ALTA com exploração improvável**, não CRÍTICA. Só a leitura do aviso de cada CVE contra a configuração real fecha a dúvida (A CONFIRMAR); a correção é barata.

```diff
- "next": "^16.2.12",
+ "next": "^16.<patch corrigido>",
```
Passos: atualizar, `npx tsc --noEmit`, `npx vitest run` (129 testes), `npx next build`, subir. Risco de quebra: baixo.

### ALTA-2 — Webhook sem assinatura

Trecho vulnerável (`webhook/dialog360/route.ts:98-101`; idêntico em `webhook/whatsapp/route.ts:110-113`):
```ts
const secret = new URL(req.url).searchParams.get("secret");
if (!process.env.WHATSAPP_WEBHOOK_SECRET || !secret || !secureEqual(secret, process.env.WHATSAPP_WEBHOOK_SECRET)) {
  return NextResponse.json({ ok: false }, { status: 401 });
}
const body = (await req.json().catch(() => null)) as Dialog360WebhookBody | null;
```
Já existe a solução pronta no mesmo repositório (`integrations/facebook/webhook/route.ts:34-44`). Trecho corrigido (rota Meta):
```ts
const raw = await req.text();
const sig = req.headers.get("x-hub-signature-256");
const ok = validSignature(raw, sig, process.env.META_APP_SECRET); // HMAC-SHA256, secureEqual
if (!ok) return NextResponse.json({ ok: false }, { status: 401 });
const body = JSON.parse(raw) as Dialog360WebhookBody;
```
Pontos de atenção (risco de quebrar): (1) o mesmo endpoint também atende o 360dialog antigo, que **não assina com o app secret da Meta**: manter o segredo na URL como alternativa enquanto existir número nesse canal; (2) a Evolution não assina, então o segredo na URL continua nela; (3) depois do deploy, **trocar o valor** de `WHATSAPP_WEBHOOK_SECRET` (e atualizar `EVOLUTION_WEBHOOK_URL` na VPS), pois o atual já passou por URLs de configuração.

### ALTA-3 — Teto de IA desligado e soma truncada

Medição (somente contagem, 10/10/2026): **0 de 12 workspaces com orçamento**; maior volume de respostas de agente no mês = 269.

Trecho vulnerável (`cost-monitor.ts:60-73`):
```ts
supabase.from("messages")
  .select("agent_id, input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens")
  .eq("workspace_id", workspaceId).eq("role", "assistant").not("agent_id", "is", null)
  .gte("created_at", startOfMonthIso())          // sem paginação: o servidor corta em 1000
```
Corrigido (esboço): função SQL que soma por `agent_id` no banco (uma linha por agente), e `getMonthToDateAgentCostUsd` multiplica pelos preços:
```sql
create or replace function month_agent_tokens(p_workspace uuid, p_from timestamptz)
returns table(agent_id uuid, input bigint, output bigint, cache_create bigint, cache_read bigint)
language sql stable security invoker set search_path = public as $$
  select agent_id, sum(input_tokens), sum(output_tokens),
         sum(cache_creation_input_tokens), sum(cache_read_input_tokens)
  from messages where workspace_id = p_workspace and role = 'assistant'
    and agent_id is not null and created_at >= p_from group by agent_id;
$$;
```
Na prática o ganho maior é **operacional**: preencher o orçamento dos 12 workspaces (valor sugerido por plano) e definir um padrão para workspace novo.
O mesmo defeito de 1.000 linhas existe em `getCostByAgentInRange`/`getDailyCostInRange` (`cost-monitor.ts:89,125,159`) e na Central de atenção (`attention-center.ts:36`): só afeta exibição.

### ALTA-4, ALTA-5, ALTA-6

Sem trecho de código (são ausências de camada): ver plano de ação. Esboço do health check:
```ts
// src/app/api/health/route.ts  (adicionar "/api/health" a PUBLIC_PATHS)
export async function GET() {
  const { error } = await createAdminClient().from("workspaces").select("id", { head: true, count: "exact" }).limit(1);
  return error ? new Response("db", { status: 503 }) : new Response("ok");
}
```

---

## 6. Fase 1 — varredura por bloco

### Bloco A — Entrada de dados
- **Validação no servidor**: existe, mas **manual** (sem Zod/schema): cada action valida `trim`, tamanho e tipo à mão (ex.: `campaigns.ts`, `workspace.ts`, `templates.ts:60-90`). Campos extras em JSON simplesmente não são lidos (não há mass-assignment: os `update` listam colunas). Lacuna: corpos de API pública sem teto (BAIXA-7). Não é falha; é dívida de padronização.
- **Injeção**: 0 SQL cru; único `.or()` com entrada do usuário é escapado (`contatos/page.tsx:55-56`, `campaigns.ts:311-331`). Nenhum `child_process`/`exec`. **Nenhum achado.**
- **XSS**: 0 ocorrências de `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`. CSP existe mas é mínima (MÉDIA-9). **Nenhum sink.**
- **Upload**: tamanho limitado nos fluxos principais (50 MB conversa, 2 MB logo/banner, cabeçalho de template validado por tipo e tamanho `template-header.ts:27-33`); nome do arquivo sempre regerado com UUID; prefixo `<workspace>/<contato>/` e bloqueio de `..` conferidos (`conversations.ts:171-174`; `isOwnHeaderPath`). **Faltam** magic bytes e varredura (BAIXA-3); mídia de conversa vai para bucket público (MÉDIA-6); `agent-media` sem validação (BAIXA-3).

### Bloco B — Identidade e permissão
- **Rotas só protegidas no front**: testado em produção sem credencial: `webhook/whatsapp` → 401, `cron/followups` → 401, `v1/leads` → 401, `/crm` → 307 para `/login`, `.env`/`.git` → 307 (login), source map → 403. **Nenhum achado.** Autorização das 149 Server Actions: as 12 que usam service role sem `requireStaff` foram lidas uma a uma — 11 conferem posse pela RLS antes de usar o `admin` (`conversations.ts:98-110,152-159,184-196`; `facebook.ts` via `pageOfWorkspace`; `integrations.ts` via `memberOfCurrentWorkspace`); 1 falha (MÉDIA-3).
- **IDOR/BOLA**: isolamento por RLS em 100% das tabelas (script comparou `create table` x `enable row level security`: 0 faltando). Tabelas de token sem policy (`integration_connections`, `calendar_connections`, `facebook_pages`). `workspaces` só editável por `developer` (`0001:164-165`). `workspace_members` só gerenciável por `developer` (`0001:169-170`), logo cliente não se adiciona a outro workspace.
- **Escalada de privilégio**: bloqueada por trigger (item 3, #1). `role`/`plan`/`hidden_pages` não são aceitos do cliente. `updateWorkspacePlan`/`updateWorkspaceFeatures` checam staff **e** a RLS exige developer.
- **Sessão/auth**: senha mínima 10 (`auth.ts:47`); mensagem de login genérica ("E-mail ou senha inválidos") e reset sempre responde sucesso (`auth.ts:30-36`), sem enumeração; login com limite por IP em memória (MÉDIA-1); **sem MFA** (MÉDIA-5); CSRF: Server Actions do Next validam `Origin`; cookies `SameSite=Lax` no cookie do workspace (`workspace.ts:39`). Expiração/rotação de token e proteção de brute force do Supabase Auth: **NÃO VERIFICADO** (painel).

### Bloco C — Segredos e exposição
- **Segredos no código/histórico**: 8 padrões (`sk-ant-`, `AIzaSy`, JWT `eyJ…`, `re_…`, `EAA…`, `SERVICE_ROLE_KEY=`, `CRON_SECRET=`, `WEBHOOK_SECRET=`) buscados em `git log --all -G` nos 236 commits: **0 ocorrências**. Único arquivo `.env*` rastreado: `.env.local.example`. **Nenhum achado.**
- **Dados sensíveis**: tokens de terceiros cifrados e sem policy (bom); `dialog360_api_key` em texto puro (MÉDIA-7); log com PII (BAIXA-1); nenhum dado sensível em query string além do segredo de webhook (ALTA-2) e do `client_secret` Meta (BAIXA-8). HSTS presente (`max-age=63072000; includeSubDomains; preload`).
- **Mensagens de erro**: actions devolvem texto genérico em português; nenhum stack trace ao cliente nos arquivos lidos. **Nenhum achado.**

### Bloco D — Superfície e infraestrutura
- **Rate limit**: MÉDIA-1. Quando estoura devolve 429 com `Retry-After` (`proxy.ts:31-34`) — correto.
- **CORS**: nenhuma configuração; mesmo-origem. **Nenhum achado.**
- **Headers (medidos no ar)**: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy: frame-ancestors 'none'`. Falta apenas CSP completa (MÉDIA-9).
- **Dependências/config**: ALTA-1; `xlsx` vem do CDN oficial da SheetJS (0.20.3), sem CVE conhecida na versão; webhooks do Facebook verificam HMAC, os de WhatsApp não (ALTA-2); SSRF no workflow (MÉDIA-4); `fetch` das integrações usa hosts fixos. Source maps de produção: 403. Sem modo debug.

### Bloco E — IA
- **Prompt injection**: instrução explícita em `agent-prompt.ts:411`; as tags de controle (`[[STATUS:]]`, `[[DADOS:]]`) só são interpretadas sobre a saída do modelo, nunca sobre texto do usuário.
- **Custo**: rate limit por contato+agente (5/min) **e por workspace (60/min)** (`agent-turn.ts:81,413-421`) + teto mensal (ALTA-3).
- **Isolamento de contexto**: o histórico enviado ao modelo é lido por `agent_id`+`contact_id` (`agent-turn.ts`); não há consulta sem `workspace_id`. Nenhum dado de outro cliente entra no contexto nos caminhos lidos.
- **Ferramentas do agente**: agenda (Google) e Nuvemshop (somente leitura, duas camadas de permissão) com escopo por workspace/agente. **Nenhum achado** além dos acima.

---

## 7. Fase 2 — Capacidade e resistência a carga

**Volume real hoje** (contagens, 10/10/2026): 12 workspaces · 10.086 contatos · 15.821 mensagens · 1.665 mensagens em 7 dias (≈ 238/dia) · pico observado ≈ 47 mensagens recebidas/hora · 8 agentes ativos · 1 campanha ativa · 4 workflows ligados.

**Caminho crítico = mensagem recebida → resposta do agente** (`runAgentTurn`):
- ≈ 12 idas ao PostgREST (contato, mensagens, rate limit por contato e por workspace, orçamento, histórico, mídia, inserts). Todas filtram por `workspace_id`/`agent_id`/`contact_id` com índice (`idx_contacts_workspace_phone`, `idx_messages_agent`, `idx_messages_workspace_created` da 0085, `idx_messages_workspace_external_id`). Nenhuma cresce com o número de clientes.
- Tempo da função: delay humanizado (padrão 3–12 s, até 120 s configurável) + LLM (2–6 s) ≈ **10–20 s de espera de I/O** por mensagem; CPU desprezível.
- **Conta**: com premissa de 50 respostas simultâneas em voo por região (Fluid agrupa requisições na mesma instância; valor conservador, NÃO VERIFICADO) e 15 s por resposta → 50 ÷ 15 ≈ **3,3 respostas/s ≈ 200/min**. Teto por workspace: 60 mensagens/min (`agent-turn.ts:81`) → 12 workspaces × 60 = **720/min** no máximo teórico. O pico real de hoje (47/hora ≈ 0,8/min) usa **~0,4 %** dessa folga.
- Banco: 200 respostas/min × 12 consultas = **2.400 req/min = 40 req/s** — trivial para o plano pago (NÃO VERIFICADO o tamanho da instância/compute e o limite de conexões; como o acesso é só via PostgREST/HTTPS, não há 1 conexão TCP por invocação).
- LLM: custo ≈ US$ 0,01–0,02 por resposta (estimativa de agosto, `pricing-calculator.ts`) → **200/min ≈ US$ 2–4/min ≈ US$ 120–240/h**. Esse é o primeiro limite que dói (financeiro), antes de qualquer componente técnico, e é a razão do ALTA-3. O limite de requisições/min do plano da Anthropic/Gemini: NÃO VERIFICADO.

**Queries que crescem com a base** (não com clientes): Pipeline (6.005 contatos na Valec) e Conversas (5.000 mensagens) trazem tudo e filtram em memória; melhorou nesta semana (busca paralela, ~600 ms) e a Etapa 2 limita o DOM, mas cada navegação ainda lê 6–10 páginas de 1.000 linhas. Estimativa de ruptura: ~20 mil contatos por workspace (limite `CONTACT_LIMIT` 10.000 no Pipeline já trunca a lista silenciosamente acima disso — **achado de dados, não de segurança**; hoje o maior tem 6.005).

**Crons**: `dispatch-campaigns` itera campanhas em série, uma mensagem por campanha por minuto (`route.ts:92`), `maxDuration` 60 s; com ~1,5–3 s por iteração (envio + escrita) cabem **20–40 campanhas ativas** antes de atrasar as últimas; hoje há 1. `followups` roda 1×/dia, em série por agente (`route.ts:47`), com teto de 20 envios por execução (`MAX_SENDS_PER_RUN`, linha 21) → **no máximo 20 follow-ups/dia no total**, o que vira limite de produto antes de virar limite técnico.

**Efeito tempestade**
- *500 usuários no mesmo minuto*: ≈ 8 respostas/s → ~125 em voo (2,5× a premissa de 50) → funções enfileiram/atrasam; o limite de 60/min por workspace corta o excesso (as mensagens excedentes **não são respondidas**, o contato precisa escrever de novo). Sem fila: a mensagem fica registrada mas sem resposta.
- *Webhook reenviando 10 mil eventos*: **idempotência existe** (índice único em `(workspace_id, external_id)`, `0045:10`) → duplicata não reprocessa nem cobra LLM. Mas cada evento ainda abre uma invocação e passa pelo segredo + rate limit em memória (120/min por IP, por instância): a rajada cabe, o custo é de invocações.
- *Sem*: fila de mensagens, backoff com retry, circuit breaker. Timeouts: `AbortSignal.timeout` só em partes (`workflow-engine.ts:499`, `evolution.ts:117`); chamadas à Anthropic/Gemini/Resend/Meta dependem do timeout do runtime (a função só morre no teto de 300 s).

**Trabalho pesado no request**: `runAgentTurn` roda dentro de `after()` (resposta 200 imediata, trabalho depois) — adequado hoje; vira candidato a fila (QStash/Inngest) acima de ~100 respostas/min. Importação de contatos e extração de PDF/XLSX rodam síncronas em Server Action (uso esporádico).

| Gargalo | Limite estimado | Sinal de alerta | Correção |
|---|---|---|---|
| Custo de LLM (sem orçamento nos 12 workspaces) | ilimitado até o teto de 60 msgs/min/workspace ≈ US$ 120–240/h no pior caso | Fatura da Anthropic/Google fora do padrão; `needs_attention` por "orçamento atingido" | Definir orçamento em todos; corrigir soma truncada (ALTA-3) |
| Respostas simultâneas do agente | ~200/min (premissa de 50 em voo × 15 s) | Mensagens sem resposta; duração de função perto de 300 s | Fila + workers acima de ~100/min; reduzir delay máximo |
| Cron `dispatch-campaigns` em série | 20–40 campanhas ativas | `next_dispatch_at` atrasando; execução > 60 s | Claim atômico + paralelizar por lote (MÉDIA-8) |
| Cron `followups` | 20 envios/dia no total | Follow-ups "esquecidos" | Subir `MAX_SENDS_PER_RUN` com paginação por agente |
| VPS única da Evolution (Baileys) | NÃO VERIFICADO (sem dado de CPU/RAM) | 5xx/timeouts em `sendText`; desconexão de instância | Monitorar a VPS; migrar clientes para API oficial |
| Telas que carregam a base inteira | ~20 mil contatos/workspace (Pipeline trunca em 10 mil) | Tempo de abertura > 3 s; lista "faltando" contatos | Paginação no servidor / contagem por SQL (Etapa 3 já feita na Visão geral) |
| Rate limit em memória | Não escala entre instâncias | Rajadas passando do limite | Redis/WAF (MÉDIA-1) |
| Observabilidade | Detecção depende de reclamação | — | ALTA-4 |

---

## 8. Fase 3 — Infraestrutura e continuidade

**CI/CD e versão**
- Secrets: nenhum workflow (não há `.github/`); variáveis ficam na Vercel — escopo por ambiente (Production/Preview) e quem tem acesso: **NÃO VERIFICADO**.
- PR externo com acesso a secrets: não aplicável (sem Actions). Branch protection / revisão obrigatória: **NÃO VERIFICADO** (`gh` indisponível); o histórico mostra commits direto em `master`.
- Build de produção: source maps não públicos (403), sem debug.
- Rollback: a Vercel permite promover o deploy anterior (1 clique/comando); **migration SQL não é reversível** — as 85 são "forward-only" (padrão `if not exists`/`create or replace`), sem `down`.

**Cache e CDN**: nenhuma rota usa `revalidate`/`force-dynamic`/`Cache-Control` customizado; páginas autenticadas leem `cookies()` e portanto são dinâmicas (não vão para o cache compartilhado do CDN). `/login` responde `public, max-age=0, must-revalidate` (conteúdo idêntico para todos, aceitável). Nenhuma chave de cache por dado sem `workspace_id` foi encontrada (não há `unstable_cache`/`use cache`). Ativos estáticos versionados por hash (Next). **Nenhum achado.**

**Escala e stateless**: a aplicação é stateless **exceto** o rate limit em memória (MÉDIA-1) — o único estado em processo. Sem WebSocket nem upload temporário em disco. Autoscaling da Vercel: **teto de gasto** configurado? **NÃO VERIFICADO** (ative o "Spend Management" no painel). Cold start/timeout: webhooks 300 s, crons 60 s. Health check: inexistente (ALTA-4).

**Disponibilidade e recuperação**

| Camada | Estado atual | Risco | O que fazer |
|---|---|---|---|
| Banco (Supabase) | Plano pago, SP; backup/PITR/restore **NÃO VERIFICADO** | Perda de até 24 h sem PITR; restore nunca testado | Conferir backup + PITR; restore de teste cronometrado (ALTA-5). Meta: RPO ≤ 15 min, RTO ≤ 2 h |
| Proteção contra destruição | Deleção em cascata por `workspace_id` (`deleteWorkspace` só `developer`, `workspace.ts:157`); sem *soft delete* | Apagar um workspace apaga tudo sem volta | Confirmação reforçada + exportação antes; *soft delete* se o negócio pedir |
| Aplicação (Vercel) | Deploy contínuo, rollback por promoção | Deploy ruim chega direto a produção (ALTA-6) | CI + proteção de branch |
| WhatsApp não oficial | 1 VPS Hostinger compartilhada (Evolution + crontab) | **Ponto único de falha**: cai a VPS = sem WhatsApp Evolution e sem disparo de campanha | Monitor externo da VPS; documentar subida em outra máquina; migrar para API oficial |
| Dependências externas | Supabase, Vercel, Meta, Anthropic/Gemini, Resend sem *fallback* | Queda de qualquer uma degrada partes (sem LLM = agente mudo) | Página de status + mensagem de degradação; alerta (ALTA-4) |
| Plano de contingência escrito | Não existe | Resposta improvisada | Runbook de 1 página: "banco caiu", "Vercel caiu", "VPS caiu", "chave vazou" |
| Segredos | Chaves na Vercel/`.env.local`; sem rotação documentada | Vazamento sem procedimento de troca | Lista de chaves + passo de rotação (começar pelo `WHATSAPP_WEBHOOK_SECRET`) |

---

## 9. Plano de ação

### Bloquear o deploy (crítico)
**Nada.** Não há achado CRÍTICO confirmado. Itens que eu trataria como "antes de vender em escala" estão no bloco seguinte.

### Primeira semana (alto)
| Item | O quê | Esforço | Risco de quebrar |
|---|---|---|---|
| ALTA-1 | Atualizar `next` (e `npm audit fix` dos transitivos), testar e subir | 1–2 h | Baixo |
| ALTA-3a | Preencher `monthly_cost_budget_brl` nos 12 workspaces e definir padrão para novos | 1 h | Nenhum (agente passa a pausar ao estourar: **avisar os clientes**) |
| ALTA-3b | Somar o custo no banco (função SQL) ou paginar `getMonthToDateAgentCostUsd` | 2–3 h | Baixo (mesmo resultado abaixo de 1.000 linhas) |
| ALTA-2 | Validar `X-Hub-Signature-256` no ramo Meta; manter segredo da URL para Evolution/360; rotacionar o segredo | 3–4 h | Médio: configurar o segredo novo na Vercel **e** na VPS na mesma janela |
| ALTA-4 | Sentry + `/api/health` + monitor externo com alerta no celular | 3–4 h | Baixo |
| ALTA-5 | Conferir backup/PITR; fazer 1 restore de teste | 2 h | Nenhum |
| ALTA-6 | GitHub Actions (`tsc`, `vitest`, `next build`) + proteção da `master` | 2 h | Nenhum |
| 4.1 / 4.2 | Executar os testes de confirmação do item 10 | 1 h | Nenhum (usar usuário de teste) |

### Backlog (médio/baixo)
| Item | Esforço |
|---|---|
| MÉDIA-1 Rate limit compartilhado (Redis/WAF), cobrir `/esqueci-senha` e `/api/e` | 4–6 h |
| MÉDIA-2 Policies de escrita só para staff em `agents`/`whatsapp_instances`/`api_keys` (mapear telas antes) | 4–8 h |
| MÉDIA-3 Conferir acesso ao `workspaceId` em `uploadWorkspaceLogo` | 30 min |
| MÉDIA-4 Proteção SSRF no `http_request` | 2 h |
| MÉDIA-5 MFA (TOTP) para `developer`/`colaborador` | 4–6 h |
| MÉDIA-6 Bucket privado + URL assinada para mídia de conversa | 6–8 h |
| MÉDIA-7 Cifrar ou remover `dialog360_api_key` | 1–2 h |
| MÉDIA-8 Claim atômico no `dispatch-campaigns` | 3–4 h |
| MÉDIA-9 CSP completa em `Report-Only` → bloqueio | 4–6 h |
| BAIXA-1…8 (log sem PII, `next` relativo, magic bytes, `secureEqual` no unsubscribe, `APP_URL` fixo, `.env.example`, limites no webhook, `client_secret` no corpo) | 3–4 h no total |
| Runbook de incidentes + documentação de rotação de segredos | 2–3 h |
| Fila para o agente (QStash/Inngest) | 1–2 dias, só quando passar de ~100 respostas/min |

---

## 10. Testes que resolvem as dúvidas ("A CONFIRMAR")

1. **Item 4.1 — trigger de `profiles` em produção.** Com um usuário `cliente` de teste (criar em `/acessos`, apagar depois), no console do navegador logado: `await supabase.from('profiles').update({ role: 'colaborador' }).eq('id', user.id)` → esperado: **erro** "Não é permitido alterar role/access_type da própria conta". Se não der erro, a migration 0044 não está aplicada: **tratar como CRÍTICA e aplicar na hora**.
2. **Item 4.2 — escrita direta em `agents` por cliente (MÉDIA-2).** Mesmo usuário: `await supabase.from('agents').insert({ workspace_id: <o dele>, name: 'x', ... })` → se inserir, o gate de plano é só de interface.
3. **ALTA-1 — aplicabilidade do `next`.** Ler cada GHSA contra a configuração (Linux/Vercel, sem `next/og`, sem `remotePatterns`). Após o upgrade, `npm audit` deve cair a 0 em `next`.
4. **BAIXA-5 — `Redirect URLs`** no painel do Supabase (Authentication → URL Configuration): não deve haver curinga `*`.
5. **Rate limit do Auth**: Supabase → Authentication → Rate Limits e "Leaked password protection".

---

## 11. Checklist final de go-live

**Segurança**
- [ ] `next` atualizado e `npm audit --omit=dev` sem "critical/high" em dependência direta
- [ ] Teste 4.1 executado em produção (a escalada de `profiles` falha)
- [ ] Teste 4.2 executado e decisão tomada sobre as policies de escrita
- [ ] Assinatura `X-Hub-Signature-256` validada no webhook da Meta
- [ ] `WHATSAPP_WEBHOOK_SECRET` rotacionado (Vercel + VPS) depois da mudança
- [ ] Orçamento de IA preenchido nos 12 workspaces e padrão definido para os novos
- [ ] Soma de custo do mês sem truncamento em 1.000 linhas
- [ ] `uploadWorkspaceLogo` confere acesso ao workspace
- [ ] MFA ativo para `developer` e `colaborador`
- [ ] "Leaked password protection" e rate limits do Supabase Auth conferidos
- [ ] Lista de Redirect URLs do Supabase sem curinga

**Operação**
- [ ] Sentry capturando erros de produção, com alerta
- [ ] `/api/health` + monitor externo (site **e** VPS) avisando no celular
- [ ] Backup diário ativo, PITR decidido, **restore de teste feito e cronometrado**
- [ ] Teto de gasto da Vercel (Spend Management) ligado
- [ ] CI (`tsc` + testes + build) obrigatório e `master` protegida
- [ ] Runbook de incidentes (banco, Vercel, VPS, vazamento de chave) escrito
- [ ] `dispatch-campaigns` com claim atômico antes de qualquer migração para cron da Vercel

**Higiene**
- [ ] `.env.local.example` completo
- [ ] Logs sem telefone/texto de cliente
- [ ] Bucket de mídia de conversa privado (ou risco aceito por escrito)
- [ ] CSP completa em Report-Only por 1–2 semanas antes de bloquear

---

## Notas metodológicas

- Sondagens em produção foram **somente `GET`/`POST` sem credencial** (esperando 401/307/403). Nenhuma exploração foi tentada; os testes de confirmação do item 10 usam usuário de teste e ficam a seu cargo.
- A análise de RLS é estática (leitura das migrations). Não foi possível inspecionar o Postgres de produção (funções e triggers realmente aplicados), por isso os itens 4.1/4.2.
- NÃO VERIFICADOS (fora do repositório): plano/compute e limites do Supabase, backup/PITR, rate limits do Auth, escopo das variáveis e permissões de deploy na Vercel, proteção de branch no GitHub, capacidade e monitoramento da VPS, limites de requisição dos provedores de LLM.
- Números de capacidade são estimativas com as premissas escritas ao lado de cada conta; trocam de ordem de grandeza se a premissa de 50 respostas simultâneas em voo mudar.
