import type Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAgentConfig } from "@/lib/agent-prompt";
import { readCredentials, setStatus } from "@/lib/integrations/connections";
import { NuvemshopError, type NuvemshopCreds } from "@/lib/integrations/nuvemshop/client";
import { effectiveCapabilityIds, NUVEMSHOP_PROVIDER } from "@/lib/integrations/nuvemshop/capabilities";
import { findOrderByNumber, findOrdersForContact, searchProducts } from "@/lib/integrations/nuvemshop/lookup";
import type { ContactIdentity } from "@/lib/integrations/nuvemshop/shape";

// Ferramentas da Nuvemshop que o agente recebe quando a integração está conectada no workspace E
// ligada no agente. Só leitura (spec 2026-10-07). Sem isso o agente nem sabe que elas existem.

type AdminClient = ReturnType<typeof createAdminClient>;
type AgentLike = { id: string; workspace_id: string; config: unknown };

export const NUVEMSHOP_TOOL_NAMES = new Set(["consultar_pedido", "consultar_produto"]);

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
  return tools;
}

// Instrução anexada ao prompt em tempo de execução (não fica no system_prompt salvo do agente).
export function nuvemshopPromptBlock(ctx: NuvemshopContext): string {
  const lines = ["\n\n## Loja online (Nuvemshop)"];
  lines.push(
    "Você tem acesso de CONSULTA à loja do cliente. Nunca invente pedido, status, prazo, preço ou estoque: se a " +
      "ferramenta não trouxer a informação, diga que não encontrou. Você não altera nada na loja."
  );
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

export function makeNuvemshopExecutor(admin: AdminClient, ctx: NuvemshopContext, contact: ContactIdentity) {
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
      return `Ferramenta "${name}" não disponível.`;
    } catch (err) {
      // Nunca loga token nem dado de cliente: só o tipo do erro.
      const kind = err instanceof NuvemshopError ? err.kind : "other";
      console.error(`Nuvemshop (${name}) falhou: ${kind}`);
      if (kind === "auth") await setStatus(admin, ctx.workspaceId, NUVEMSHOP_PROVIDER, "reconectar", "Token recusado pela Nuvemshop.").catch(() => {});
      return (
        "ERRO_LOJA: não foi possível consultar a loja agora. Diga ao cliente que vai verificar e que retorna em breve. " +
        "Não invente nenhuma informação. [[PRECISA_HUMANO]]"
      );
    }
  };
}
