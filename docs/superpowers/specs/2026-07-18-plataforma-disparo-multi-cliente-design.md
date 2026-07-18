# Plataforma de Disparo Multi-Cliente — Desenho Técnico

Data: 2026-07-18
Status: Aprovado (aguardando revisão final do usuário antes de virar plano de implementação)

## Contexto

A agência já opera um piloto mono-cliente para a Hanoi Editora (`C:\Projetos-Dev\Agente WhatsApp`): agente de IA (Claude) respondendo WhatsApp via Evolution API, rodando local, sem autenticação, com SQLite em arquivo único e prompt/catálogo fixos no código.

Um novo cliente precisa de disparo em massa (WhatsApp e e-mail) **sem** agente de IA. Isso não cabe no piloto atual, que não tem noção de "cliente" em lugar nenhum do código ou do banco.

## Objetivo

Construir uma plataforma nova, multi-cliente desde a raiz, onde:
- Cada cliente (workspace) só vê e opera os próprios dados.
- A agência (dono da plataforma) enxerga e gerencia todos os workspaces.
- Suporta, no MVP, disparo em massa de WhatsApp e e-mail **sem** agente de IA.
- É construída para, depois, incorporar o modo "agente de IA" (o que a Hanoi já usa) como mais um tipo de campanha por workspace.

## Fora de escopo (não-objetivos deste spec)

- **Agente de IA por workspace** — reaproveita padrões da Hanoi (busca de catálogo, prompt customizável, classificação de conversa), mas é um spec/implementação separada, depois que a fundação multi-tenant existir.
- **Migração de dados da Hanoi** para dentro da plataforma nova — acontece depois que o MVP (disparo sem agente) estiver validado com o novo cliente. A pasta `Agente WhatsApp` continua rodando como está, sem mudanças, até essa migração ser decidida.
- **Billing/cobrança automática dos clientes** — não mencionado como necessidade agora.
- **App mobile** — só painel web.

## Arquitetura

```
┌──────────────────────────┐        ┌───────────────────────────────┐
│   Vercel (Next.js)        │        │   VPS (Docker)                  │
│   - Login/Auth (Supabase) │◄──────►│   - Evolution API                │
│   - Painel por workspace  │  HTTP  │     (1 instância por workspace,  │
│   - API routes            │        │      WhatsApp de cada cliente)   │
└───────────┬────────────────┘        │   - Worker de disparo             │
            │                         │     (processo Node sempre ligado, │
            ▼                         │      respeita rampa/janela/delay  │
┌──────────────────────────┐        │      por workspace)                │
│   Supabase                │◄──────►│   - Envio de e-mail (Resend)       │
│   - Postgres               │        └───────────────────────────────┘
│   - Auth                   │
│   - RLS (isolamento por     │
│     workspace_id na linha)  │
└──────────────────────────┘
```

**Racional da divisão:** o painel/API não precisam de processo sempre ligado — rodam serverless na Vercel, escalam sozinhos, e o plano gratuito cobre o volume esperado no início. Só o que exige conexão persistente (sessão WhatsApp via Baileys/Evolution, e o loop de disparo pausado que respeita ritmo anti-ban) fica na VPS, seguindo exatamente o padrão já validado no piloto da Hanoi.

## Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Frontend + API | Next.js na Vercel | Serverless, escala sozinho, hospedagem gratuita nesse volume |
| Banco de dados | Supabase (Postgres) | Gratuito até 500MB/50k usuários de auth; RLS nativo pro isolamento |
| Autenticação | Supabase Auth | Vem junto do banco, sem integração extra |
| WhatsApp | Evolution API (Docker, VPS) | Já validado no piloto da Hanoi; suporta múltiplas instâncias nomeadas no mesmo deploy |
| E-mail | Resend (a confirmar limites do plano gratuito antes de implementar) | Boa integração com Next.js, API simples |

## Modelo de dados (visão inicial)

Todas as tabelas abaixo (exceto `workspaces` e `users`) carregam `workspace_id` e têm política RLS: só é visível/editável por membros daquele workspace (ou pela role `agency_admin`, que enxerga tudo).

- **`workspaces`** — um por cliente. `id`, `name`, `created_at`.
- **`workspace_members`** — liga usuários (Supabase Auth) a workspaces, com `role` (`agency_admin` | `client_owner` | `client_member`).
- **`contacts`** — `workspace_id`, `name`, `phone`, `email`, `custom_fields` (jsonb), `opt_out_whatsapp`, `opt_out_email`.
- **`campaigns`** — `workspace_id`, `name`, `channel` (`whatsapp` | `email`), `mode` (`blast` | `agent` — só `blast` implementado agora), `message_template`(s), `status`, `ramp_config` (jsonb: rampa/janela/delay).
- **`campaign_recipients`** — fila de envio: `campaign_id`, `contact_id`, `status` (`pendente|enviado|falhou|invalido`), `sent_at`.
- **`whatsapp_instances`** — `workspace_id`, nome da instância na Evolution API, status de conexão.
- **`messages`** (opcional no MVP, mas provável) — histórico de mensagens trocadas por contato, pra dar visibilidade no painel tipo a aba "Conversas" que a Hanoi já tem hoje.

## Fluxo de disparo (WhatsApp e e-mail)

1. Cliente sobe uma lista de contatos (CSV/planilha) ou usa a base já cadastrada.
2. Cria uma campanha: canal (WhatsApp ou e-mail), template(s) de mensagem, rampa/janela (mesma lógica anti-ban da Hanoi: dia 1 manda menos, aumenta aos poucos, delay aleatório entre envios, janela de horário).
3. O worker na VPS (um processo por workspace ou um processo único que itera todos os workspaces — decidir na fase de plano) lê `campaign_recipients` pendentes, respeita a cota/janela do workspace, e dispara via Evolution API (WhatsApp) ou Resend (e-mail).
4. Cada envio atualiza `campaign_recipients.status` e loga em `messages`.
5. Opt-out (WhatsApp: "sair"/"pare"; e-mail: link de descadastro) marca o contato e para os disparos futuros pra ele, em qualquer campanha do workspace.

## Onboarding de um cliente novo

1. Agência cria o `workspace` e convida o cliente por e-mail (Supabase Auth — convite/magic link).
2. Cliente define senha, loga, só vê o próprio workspace.
3. Agência (ou o próprio cliente, se tiver permissão) conecta o número de WhatsApp dele: cria uma instância nova na Evolution API (mesmo fluxo de QR code já usado com a Hanoi) e/ou configura o remetente de e-mail.

## Tratamento de erros

- Número de WhatsApp inválido → marca `campaign_recipients.status = 'invalido'`, não trava a fila.
- Falha de envio (Evolution/Resend fora do ar) → tenta de novo com backoff, some não resolver em N tentativas, marca `falhou` e segue a fila.
- E-mail: bounce/reclamação de spam → marca opt-out automático do contato (evita dano à reputação do domínio de envio).

## Testes / validação

- Cada camada testável isoladamente: fila de disparo (sem depender de WhatsApp/e-mail real), integração Evolution API (já provada no piloto), integração Resend (sandbox de teste).
- Antes de ligar pro cliente real: testar com número/e-mail próprio da agência, validar rampa/janela funcionando, validar isolamento (logar como um workspace, confirmar que não vê dados de outro).

## Pendências a confirmar antes/durante a implementação

- Limites exatos do plano gratuito do Resend (equivalente ao que já foi confirmado pro Supabase).
- Se o worker de disparo roda um processo por workspace ou um processo único cobrindo todos (decisão de implementação, não muda o modelo de dados).
- Domínio de envio de e-mail (precisa de um dono verificado — `@hanoieditora.com.br` não serve pro cliente novo).
