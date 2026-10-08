# Integração Nuvemshop — desenho (rascunho para aprovação)

Data: 2026-10-07. Status: **aguardando aprovação do dono, nenhum código escrito.**

## Objetivo

O agente de IA consulta a loja Nuvemshop do cliente (pedidos primeiro) durante a conversa no WhatsApp.
A conexão é por workspace, feita na aba Integrações; o que cada agente pode usar é escolhido na
configuração do agente. Nada disso é obrigatório: workspace sem Nuvemshop conectada não muda em nada.

## Regras que não se negociam

1. **Loja de cliente real: leitura apenas na v1.** Só `GET` contra a API. Nenhuma ação que altere pedido,
   produto, cliente, cupom ou webhook entra nesta versão, nem para teste.
2. **O agente nunca recebe o objeto cru da API.** O pedido traz `cost` do produto, `token` do pedido,
   `gateway_link`, dados de pagamento e endereços completos. Cada ferramenta devolve uma lista fixa de
   campos montada no servidor.
3. **Só mostra pedido de quem está na conversa.** O telefone ou e-mail do pedido precisa bater com o
   contato da conversa; senão o agente responde que não encontrou. Impede o cliente A de pedir o pedido
   do cliente B informando um número.
4. **Token nunca volta para o navegador.** Entra por server action, é cifrado (AES-256-GCM, mesmo
   módulo `src/lib/calendar/crypto.ts`) e a tabela tem RLS sem policy, como `calendar_connections`.
5. **Cada workspace só enxerga a própria loja.** A busca da conexão sempre filtra por `workspace_id`
   do agente.

## Fluxo em duas camadas (pedido do dono)

### Camada 1 — Integrações (workspace)

`/integracoes` ganha o card **Nuvemshop** e a página `/integracoes/nuvemshop`:

- Formulário **ID da loja + token**. "Conectar" valida com `GET /store` (read-only), grava o nome e o
  plano da loja e guarda o token cifrado.
- Lista de **permissões** do catálogo (ver abaixo), cada uma com liga/desliga. O workspace liga só o
  que acha necessário. Tudo que a plataforma sabe fazer com a Nuvemshop aparece aqui, inclusive o que
  ainda não está disponível (aparece travado, com "em breve").
- Desconectar apaga a linha (e o token) e desliga as permissões nos agentes.
- "Testar conexão" refaz `GET /store`. Falha de autenticação vira status `reconectar`.

### Camada 2 — Agente

Nova aba **Integrações** em `agent-config-form.tsx` (`AGENT_TABS`), depois de "Humano e agenda":

- Só aparecem integrações **conectadas no workspace**, e dentro delas só as permissões que o
  workspace ligou.
- Cada permissão tem um botão liga/desliga **por agente**. Ligada, aparece uma observação embaixo
  dizendo para que serve (ex.: "Consulta de pedidos: o agente informa status, pagamento, envio e itens
  do pedido do cliente.").
- Efetivo = permissão ligada no workspace **E** ligada no agente. Desligar no workspace tira do agente
  na hora, sem precisar editar o agente.
- Guardado em `agents.config.integrations` (jsonb, igual `scheduling` e `sellerTasks`). **Sem migration
  na tabela de agentes.** Desligado por padrão.

## Catálogo de permissões (v1)

| id | tipo | disponível na v1 | o que o agente faz |
|---|---|---|---|
| `nuvemshop.pedidos.consultar` | leitura | sim | status do pedido, pagamento, envio, rastreio (se existir), itens, total |
| `nuvemshop.produtos.consultar` | leitura | sim | nome, preço, estoque, descrição, link |
| `nuvemshop.clientes.consultar` | leitura | não (só localiza o cliente pelo contato, interno) | — |
| `nuvemshop.pedidos.fechar` / `cancelar` / `nota` | escrita | **travado, em breve** | exige definição do dono + teste em loja de demonstração |

O catálogo vive em código (`src/lib/integrations/nuvemshop/capabilities.ts`): id, rótulo, tipo,
`agentNote`, `available`. Acrescentar integração ou permissão nova não exige migration.

## Dados

Migration **0082** `integration_connections` (genérica, serve a próximas integrações):

```
id uuid pk
workspace_id uuid not null references workspaces on delete cascade
provider text not null            -- 'nuvemshop'
external_id text not null         -- store_id
display_name text                 -- nome da loja
credentials_enc text not null     -- token cifrado
enabled_capabilities text[] not null default '{}'
status text not null default 'conectado'   -- conectado | reconectar
last_error text
connected_at, updated_at timestamptz
unique (workspace_id, provider)   -- uma loja por workspace na v1
```

RLS ligado, **sem policy** (só service role). Migration entregue como SQL para o dono rodar à mão e
conferida via REST antes de qualquer deploy.

## Ferramentas do agente (v1, só leitura)

Módulo `src/lib/integrations/nuvemshop/` seguindo `scheduling-tools.ts`:

- `consultar_pedido` — sem argumento busca os pedidos recentes **do contato da conversa**; com número
  do pedido, busca esse e confere se pertence ao contato.
- `consultar_produto` — por nome ou SKU: nome, preço, estoque disponível, link.

Ligação em `agent-turn.ts` ao lado de `buildSchedulingTools`: só entra se a permissão estiver ligada
no workspace e no agente. O bloco de prompt vai anexado em tempo de execução (não altera o
`system_prompt` salvo), como o agendamento.

- Cliente HTTP único: `GET` apenas (o wrapper nem expõe outro método), `User-Agent` obrigatório,
  timeout de 8 s, leitura dos headers `x-rate-limit-*` e recuo em 429.
- Erro da API nunca vai cru para o cliente: o agente diz que não conseguiu consultar agora e segue.
- Campos de pedido repassados ao modelo: número, status, pagamento, envio, data, itens (nome,
  quantidade), total, rastreio. Nada de endereço completo, documento, custo, token ou link de gateway.

## Pontos em aberto

1. **Rastreio:** no pedido enviado que olhei, `shipping_tracking_number` e `shipping_tracking_url`
   vieram vazios. Antes de prometer rastreio, verificar em mais pedidos e em `fulfillments` onde a loja
   deste cliente grava o código.
2. **Escrita:** o que "dar baixa" significa para o cliente (fechar, cancelar, enviado) ainda não foi
   definido. Quando for, entra como permissão nova, travada até haver teste em loja de demonstração.
3. **Várias lojas por workspace:** fora da v1 (a restrição `unique (workspace_id, provider)` fecha isso).
4. **Webhooks:** fora da v1. O agente consulta na hora; avisar pedido novo/enviado exigiria app com
   segredo próprio.
5. **Escopos do token:** o app do cliente deve ter só leitura (`read_orders`, `read_products`,
   `read_customers`). Escrita no token só quando uma permissão de escrita for liberada.

## Testes

Vitest: lista fixa de campos (nada sensível vaza), casamento telefone/e-mail do contato com o pedido
(inclusive número sem DDI, com 9 dígito, e-mail em caixa diferente), interseção workspace × agente,
cifra do token, e que o cliente HTTP recusa método diferente de GET. Teste manual: loja real só com
`GET`, conferindo contagens, sem imprimir dados de cliente.

## Ordem de entrega

1. Migration 0082 + conferência no banco.
2. Cliente HTTP read-only + catálogo + conexão (salvar/validar/desconectar).
3. Página `/integracoes/nuvemshop` + card.
4. Aba Integrações no agente.
5. Ferramentas e ligação no `agent-turn`.
6. Testes, build, e só então "pode subir".
