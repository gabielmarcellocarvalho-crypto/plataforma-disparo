import type Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAgentConfig } from "@/lib/agent-prompt";
import { readCredentials, setStatus } from "@/lib/integrations/connections";
import { createDraftOrder, NuvemshopError, type NuvemshopCreds } from "@/lib/integrations/nuvemshop/client";
import { effectiveCapabilityIds, NUVEMSHOP_PROVIDER } from "@/lib/integrations/nuvemshop/capabilities";
import { findOrderByNumber, findOrdersForContact, searchProducts } from "@/lib/integrations/nuvemshop/lookup";
import type { ContactIdentity } from "@/lib/integrations/nuvemshop/shape";

// Ferramentas da Nuvemshop que o agente recebe quando a integração está conectada no workspace E
// ligada no agente. Consulta, mais a criação de link de pagamento (pedido rascunho, nunca confirmado).
// Sem isso o agente nem sabe que elas existem.

type AdminClient = ReturnType<typeof createAdminClient>;
type AgentLike = { id: string; workspace_id: string; config: unknown };

export const NUVEMSHOP_TOOL_NAMES = new Set(["consultar_pedido", "consultar_produto", "criar_link_pagamento"]);

export type NuvemshopContext = {
  workspaceId: string;
  creds: NuvemshopCreds;
  capabilities: Set<string>;
};

// null quando não há nada pra oferecer neste agente: aí nada muda (nem ferramenta, nem prompt).
export async function getNuvemshopContext(admin: AdminClient, agent: AgentLike): Promise<NuvemshopContext | null> {
  const agentIds = normalizeAgentConfig(agent.config).integrations[NUVEMSHOP_PROVIDER];
  if (!agentIds || agentIds.length === 0) return null;
  const conn = await readCredentials(admin, agent.workspace_id, NUVEMSHOP_PROVIDER);
  if (!conn || conn.status !== "conectado") return null;
  const capabilities = effectiveCapabilityIds(conn.enabledCapabilities, agentIds);
  if (capabilities.size === 0) return null;
  return { workspaceId: agent.workspace_id, creds: { storeId: conn.externalId, token: conn.token }, capabilities };
}

export function buildNuvemshopTools(ctx: NuvemshopContext): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [];
  if (ctx.capabilities.has("nuvemshop.pedidos.consultar")) {
    tools.push({
      name: "consultar_pedido",
      description:
        "Consulta na loja os pedidos de quem está nesta conversa (status, pagamento, envio, itens). Sem número, devolve " +
        "os pedidos mais recentes deste cliente. Com o número do pedido, devolve esse pedido, mas só se for deste cliente. " +
        "Use SEMPRE que o cliente perguntar de pedido; nunca invente status.",
      input_schema: {
        type: "object",
        properties: { numero: { type: "string", description: "Número do pedido que o cliente informou (opcional)" } },
        required: [],
      },
    });
  }
  if (ctx.capabilities.has("nuvemshop.produtos.consultar")) {
    tools.push({
      name: "consultar_produto",
      description:
        "Busca produtos da loja por nome ou código e devolve preço, estoque e link. Use quando o cliente perguntar de " +
        "produto, preço ou disponibilidade; nunca invente preço nem estoque.",
      input_schema: {
        type: "object",
        properties: { busca: { type: "string", description: "Nome ou código do produto" } },
        required: ["busca"],
      },
    });
  }
  if (ctx.capabilities.has("nuvemshop.pedidos.link_pagamento")) {
    tools.push({
      name: "criar_link_pagamento",
      description:
        "Cria na loja um pedido rascunho com os itens que o cliente escolheu e devolve o link de pagamento para enviar a ele. " +
        "Use SOMENTE depois de o cliente confirmar os itens, as quantidades e o tamanho/variação, e de você ter nome, sobrenome e " +
        "e-mail dele. Use o variante_id devolvido por consultar_produto. Não confirma o pedido nem cobra: o cliente paga pelo link.",
      input_schema: {
        type: "object",
        properties: {
          nome: { type: "string", description: "Primeiro nome do cliente" },
          sobrenome: { type: "string", description: "Sobrenome do cliente" },
          email: { type: "string", description: "E-mail do cliente" },
          itens: {
            type: "array",
            description: "Itens do pedido (no máximo 5)",
            items: {
              type: "object",
              properties: {
                variante_id: { type: "number", description: "variante_id de consultar_produto" },
                quantidade: { type: "number", description: "Quantidade (1 a 10)" },
              },
              required: ["variante_id", "quantidade"],
            },
          },
        },
        required: ["nome", "sobrenome", "email", "itens"],
      },
    });
  }
  return tools;
}

// Instrução anexada ao prompt em tempo de execução (não fica no system_prompt salvo do agente).
export function nuvemshopPromptBlock(ctx: NuvemshopContext): string {
  const lines = ["\n\n## Loja online (Nuvemshop)"];
  const canLink = ctx.capabilities.has("nuvemshop.pedidos.link_pagamento");
  lines.push(
    "Você tem acesso de CONSULTA à loja do cliente. Nunca invente pedido, status, prazo, preço ou estoque: se a " +
      "ferramenta não trouxer a informação, diga que não encontrou. " +
      (canLink ? "A única coisa que você cria na loja é o link de pagamento; não altera nada além disso." : "Você não altera nada na loja.")
  );
  if (canLink) {
    lines.push(
      "Link de pagamento: antes de criar, confirme com o cliente os itens, tamanho/variação e quantidades, e peça nome, " +
        "sobrenome e e-mail se ainda não tiver. Só ofereça produto com estoque (consultar_produto). Chame criar_link_pagamento " +
        "UMA vez por compra e envie o link devolvido, dizendo que o pagamento e o frete são concluídos na página da loja. Não " +
        "prometa reserva de estoque, desconto ou prazo de entrega que a ferramenta não trouxe. Se a ferramenta falhar, não " +
        "invente link: avise que vai verificar e inclua [[PRECISA_HUMANO]]."
    );
  }
  if (ctx.capabilities.has("nuvemshop.pedidos.consultar")) {
    lines.push(
      "Pedidos: só fale de pedido que a ferramenta consultar_pedido devolver, e só do cliente desta conversa. Se ele pedir " +
        "pedido de outra pessoa, não informe. Se não achar, peça o número do pedido e tente de novo. Quando a ferramenta não " +
        "trouxer código de rastreio, informe só o status do envio e não prometa rastreio. Se o cliente pedir para cancelar, " +
        "alterar, reembolsar ou trocar um pedido, você não consegue fazer isso: não prometa a ação, siga a conversa " +
        "normalmente e inclua [[PRECISA_HUMANO]] ao final."
    );
  }
  if (ctx.capabilities.has("nuvemshop.produtos.consultar")) {
    lines.push("Produtos: use consultar_produto para preço, variações e estoque, e passe o link quando existir.");
  }
  return lines.join("\n");
}

const MAX_LINKS_PER_TURN = 2;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valida o que o modelo mandou antes de tocar na loja: ele pode errar ou ser induzido por mensagem do cliente.
async function criarLinkPagamento(
  ctx: NuvemshopContext,
  contact: ContactIdentity,
  input: Record<string, unknown>,
  state: { links: number }
): Promise<Record<string, unknown>> {
  if (state.links >= MAX_LINKS_PER_TURN) return { erro: "Já foi criado link de pagamento nesta conversa agora. Envie o que já foi criado." };
  const nome = String(input.nome ?? "").trim().slice(0, 60);
  const sobrenome = String(input.sobrenome ?? "").trim().slice(0, 80);
  const email = String(input.email ?? "").trim().slice(0, 120);
  if (!nome || !sobrenome) return { erro: "Falta nome e sobrenome do cliente. Peça a ele." };
  if (!EMAIL_RE.test(email)) return { erro: "E-mail inválido ou ausente. Peça o e-mail ao cliente." };
  const raw = Array.isArray(input.itens) ? (input.itens as Record<string, unknown>[]) : [];
  const items = raw.slice(0, 5).map((i) => ({ variantId: Number(i?.variante_id), quantity: Number(i?.quantidade) }));
  if (items.length === 0 || items.some((i) => !Number.isInteger(i.variantId) || i.variantId <= 0 || !Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 10)) {
    return { erro: "Itens inválidos. Use o variante_id de consultar_produto e quantidade de 1 a 10." };
  }
  state.links++;
  const draft = await createDraftOrder(ctx.creds, { name: nome, lastname: sobrenome, email, phone: contact.phone, items });
  return { link_pagamento: draft.checkoutUrl, aviso: "Envie este link ao cliente. O pedido só vale quando ele pagar." };
}

export function makeNuvemshopExecutor(admin: AdminClient, ctx: NuvemshopContext, contact: ContactIdentity) {
  const state = { links: 0 };
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    try {
      if (name === "consultar_pedido" && ctx.capabilities.has("nuvemshop.pedidos.consultar")) {
        const numero = String(input.numero ?? "").trim();
        if (numero) {
          const order = await findOrderByNumber(ctx.creds, contact, numero);
          return JSON.stringify(
            order ? { pedidos: [order] } : { pedidos: [], aviso: "Não encontrei esse pedido para este cliente." }
          );
        }
        const orders = await findOrdersForContact(ctx.creds, contact);
        return JSON.stringify(
          orders.length ? { pedidos: orders } : { pedidos: [], aviso: "Não encontrei pedidos para este cliente. Peça o número do pedido." }
        );
      }
      if (name === "consultar_produto" && ctx.capabilities.has("nuvemshop.produtos.consultar")) {
        const produtos = await searchProducts(ctx.creds, String(input.busca ?? ""));
        return JSON.stringify(produtos.length ? { produtos } : { produtos: [], aviso: "Nenhum produto encontrado com essa busca." });
      }
      if (name === "criar_link_pagamento" && ctx.capabilities.has("nuvemshop.pedidos.link_pagamento")) {
        return JSON.stringify(await criarLinkPagamento(ctx, contact, input, state));
      }
      return `Ferramenta "${name}" não disponível.`;
    } catch (err) {
      // Nunca loga token nem dado de cliente: só o tipo do erro.
      const kind = err instanceof NuvemshopError ? err.kind : "other";
      console.error(`Nuvemshop (${name}) falhou: ${kind}`);
      if (kind === "auth" && name === "criar_link_pagamento") {
        return "ERRO_LOJA: a loja não permitiu criar o link de pagamento agora. Diga ao cliente que vai verificar e retorna em breve. [[PRECISA_HUMANO]]";
      }
      if (kind === "auth") await setStatus(admin, ctx.workspaceId, NUVEMSHOP_PROVIDER, "reconectar", "Token recusado pela Nuvemshop.").catch(() => {});
      return (
        "ERRO_LOJA: não foi possível consultar a loja agora. Diga ao cliente que vai verificar e que retorna em breve. " +
        "Não invente nenhuma informação. [[PRECISA_HUMANO]]"
      );
    }
  };
}
