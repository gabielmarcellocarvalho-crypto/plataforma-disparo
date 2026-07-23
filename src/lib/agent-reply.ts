import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const ATTENTION_TAG = /\[\[PRECISA_HUMANO\]\]/i;
// Tag de classificação de status da conversa (ex.: [[STATUS: interessado]]) — o prompt do agente
// instrui a sempre incluir isso, mas é só pra uso interno; nunca deveria chegar no texto pro cliente.
const STATUS_TAG = /\[\[STATUS:\s*[a-zà-ú]+\s*\]\]/i;
// Dados que o agente coletou do contato (config "informações que preciso") — vira update em
// contacts.custom_fields. Formato: [[DADOS: chave=valor; chave2=valor2]].
const DADOS_TAG = /\[\[DADOS:\s*([^\]]*)\]\]/i;

function parseCollectedData(text: string): Record<string, string> {
  const match = text.match(DADOS_TAG);
  if (!match) return {};
  const data: Record<string, string> = {};
  for (const pair of match[1].split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key && value) data[key] = value;
  }
  return data;
}

export type ConversationMessage = { role: "user" | "assistant"; content: string };

// Foto que o cliente mandou nessa mensagem, pra o modelo enxergar (Claude tem visão nativa).
export type AgentImage = { base64: string; mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp" };

export type AgentReplyContact = {
  name: string | null;
  custom_fields: Record<string, unknown> | null;
};

export type AgentReply = {
  reply: string;
  needsHuman: boolean;
  collectedData: Record<string, string>;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
};

// Executor de ferramenta: recebe nome + argumentos que o modelo pediu, executa o efeito
// (mandar foto, gerar link de pagamento, consultar disponibilidade...) e devolve o resultado
// em texto pra o modelo. Retornar algo com "PRECISA_HUMANO" marca a conversa pra atenção humana.
export type ToolExecutor = (name: string, input: Record<string, unknown>) => Promise<string>;

const MAX_TOOL_ITERATIONS = 6;

// Gera a resposta do agente pra uma mensagem recebida, dado o prompt configurado pro agente
// e o histórico de conversa já salvo com esse contato. Se `tools`/`executeTool` forem passados,
// roda o loop de tool-calling (o modelo pode chamar ferramentas antes de dar a resposta final).
export async function generateReply(
  systemPrompt: string,
  contact: AgentReplyContact,
  history: ConversationMessage[],
  currentImages: AgentImage[] = [],
  tools: Anthropic.Tool[] = [],
  executeTool?: ToolExecutor,
  knowledgeText?: string
): Promise<AgentReply> {
  const camposExtras = contact.custom_fields && Object.keys(contact.custom_fields).length
    ? ` Dados adicionais: ${JSON.stringify(contact.custom_fields)}.`
    : "";
  const contactContext = `Dados do contato: nome="${contact.name || "desconhecido"}".${camposExtras}`;

  const historyMessages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));

  // Anexa as fotos recebidas nessa mensagem ao último turno do usuário (visão só no turno atual —
  // manter imagens no histórico inteiro encareceria demais; o modelo já "viu" e respondeu sobre elas).
  if (currentImages.length && historyMessages.length) {
    const last = historyMessages[historyMessages.length - 1];
    if (last.role === "user" && typeof last.content === "string") {
      const imageBlocks: Anthropic.ImageBlockParam[] = currentImages.map((img) => ({
        type: "image",
        source: { type: "base64", media_type: img.mediaType, data: img.base64 },
      }));
      const textBlocks: Anthropic.TextBlockParam[] = last.content ? [{ type: "text", text: last.content }] : [];
      last.content = [...imageBlocks, ...textBlocks];
    }
  }

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `<contexto>${contactContext}</contexto>` },
    { role: "assistant", content: "Entendido, vou conduzir a conversa com esse contato." },
    ...historyMessages,
  ];

  // Bloco separado (cache próprio) pra material de estudo — nunca repetir isso literalmente pro
  // cliente, é só referência interna do agente sobre a empresa.
  const systemBlocks: Anthropic.TextBlockParam[] = [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }];
  if (knowledgeText) {
    systemBlocks.push({
      type: "text",
      text:
        "Material de estudo sobre a empresa (referência interna pra responder com mais precisão — nunca cite isso " +
        `literalmente nem diga "de acordo com meus arquivos"):\n\n${knowledgeText}`,
      cache_control: { type: "ephemeral" },
    });
  }

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheCreationInputTokens = 0;
  let cacheReadInputTokens = 0;
  let needsHuman = false;
  let finalText = "";

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system: systemBlocks,
      messages,
      ...(tools.length ? { tools } : {}),
    });

    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    cacheCreationInputTokens += response.usage.cache_creation_input_tokens ?? 0;
    cacheReadInputTokens += response.usage.cache_read_input_tokens ?? 0;

    if (response.stop_reason === "refusal") {
      return {
        reply: "Vou confirmar isso com a equipe e já retorno.",
        needsHuman: true,
        collectedData: {},
        inputTokens,
        outputTokens,
        cacheCreationInputTokens,
        cacheReadInputTokens,
      };
    }

    finalText = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const toolUses = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === "tool_use");

    if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

    // Preserva a resposta inteira (thinking + tool_use) — obrigatório pra continuar o turno com
    // as ferramentas — e devolve o resultado de cada ferramenta pro modelo.
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      let result = "Ferramenta indisponível.";
      if (executeTool) {
        try {
          result = await executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
        } catch (err) {
          result = `Erro ao executar ${toolUse.name}: ${(err as Error).message}`;
        }
      }
      if (/PRECISA_HUMANO/i.test(result)) needsHuman = true;
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: result });
    }
    messages.push({ role: "user", content: toolResults });
  }

  needsHuman = needsHuman || ATTENTION_TAG.test(finalText);
  const collectedData = parseCollectedData(finalText);
  finalText = finalText.replace(ATTENTION_TAG, "").replace(STATUS_TAG, "").replace(DADOS_TAG, "").trim();

  return { reply: finalText, needsHuman, collectedData, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens };
}
