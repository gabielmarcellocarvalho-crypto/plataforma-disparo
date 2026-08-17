import { GoogleGenAI } from "@google/genai";
import type Anthropic from "@anthropic-ai/sdk";
import {
  ATTENTION_TAG,
  STATUS_TAG,
  DADOS_TAG,
  MESSAGE_SPLIT_TAG,
  parseStage,
  parseCollectedData,
  type AgentReply,
  type AgentReplyContact,
  type ConversationMessage,
  type AgentImage,
  type ToolExecutor,
} from "@/lib/agent-reply";

// Provider alternativo ao Claude (src/lib/agent-reply.ts) — habilitado por agente via
// agents.llm_provider = 'gemini'. Pilotado por custo (Gemini 3 Flash é mais barato que o Sonnet),
// não é o padrão pra nenhum agente existente. Mesma assinatura/formato de retorno do generateReply
// do Claude — o webhook e o worker de follow-up só trocam qual função chamar.
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_MODEL || "gemini-3-flash-preview";

const MAX_TOOL_ITERATIONS = 6;

type GeminiContentPart = { type: "text"; text: string } | { type: "image"; data: string; mime_type: string };
// A API de interactions do Gemini tem duas versões de formato de input: "turn_list" (antigo, {role,
// content}) e "step_list" ({type: "user_input"|"model_output", content}) — contas mais novas exigem
// step_list e rejeitam turn_list com 400 ("use step_list input format instead of turn_list"). Os
// steps de saída (function_call/function_result) já eram tratados nesse formato; só a entrada
// (histórico da conversa) ainda usava turn_list — por isso NENHUMA resposta desse provider saía.
type GeminiStep = { type: "user_input" | "model_output"; content: GeminiContentPart[] };

function toGeminiTool(tool: Anthropic.Tool) {
  return {
    type: "function" as const,
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  };
}

// Mesmo colapso de turnos consecutivos do mesmo papel que o provider Claude faz — não é exigência
// conhecida da API do Gemini, mas mantém o formato do histórico idêntico entre os dois providers.
function collapseConsecutiveSteps(steps: GeminiStep[]): GeminiStep[] {
  const out: GeminiStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && last.type === s.type) {
      last.content = [...last.content, ...s.content];
    } else {
      out.push({ type: s.type, content: [...s.content] });
    }
  }
  return out;
}

export async function generateReplyGemini(
  systemPrompt: string,
  contact: AgentReplyContact,
  history: ConversationMessage[],
  currentImages: AgentImage[] = [],
  tools: Anthropic.Tool[] = [],
  executeTool?: ToolExecutor,
  knowledgeText?: string,
  followUpNudge?: string
): Promise<AgentReply> {
  const camposExtras = contact.custom_fields && Object.keys(contact.custom_fields).length
    ? ` Dados adicionais: ${JSON.stringify(contact.custom_fields)}.`
    : "";
  const missedNote = contact.missedOffHours
    ? " O cliente mandou mensagem fora do horário de atendimento e ainda não foi respondido. Antes de continuar, " +
      "mande uma mensagem BEM curta reconhecendo isso (algo como 'oi, vi sua mensagem, retomando agora' — sem repetir " +
      "o horário todo) e só depois siga a conversa normalmente."
    : "";
  const contactContext = `Dados do contato: nome="${contact.name || "desconhecido"}".${camposExtras}${missedNote}`;

  const historySteps: GeminiStep[] = collapseConsecutiveSteps(
    history.map((m) => ({
      type: m.role === "assistant" ? "model_output" : "user_input",
      content: [{ type: "text", text: m.content }] as GeminiContentPart[],
    }))
  );

  if (currentImages.length && historySteps.length) {
    const last = historySteps[historySteps.length - 1];
    if (last.type === "user_input") {
      const imageParts: GeminiContentPart[] = currentImages.map((img) => ({ type: "image", data: img.base64, mime_type: img.mediaType }));
      last.content = [...imageParts, ...last.content];
    }
  }

  const steps: GeminiStep[] =
    historySteps[0]?.type === "model_output"
      ? [{ type: "user_input", content: [{ type: "text", text: `<contexto>${contactContext}</contexto>` }] }, ...historySteps]
      : [
          { type: "user_input", content: [{ type: "text", text: `<contexto>${contactContext}</contexto>` }] },
          { type: "model_output", content: [{ type: "text", text: "Entendido, vou conduzir a conversa com esse contato." }] },
          ...historySteps,
        ];

  let systemInstruction = systemPrompt;
  if (knowledgeText) {
    systemInstruction +=
      "\n\nMaterial de estudo sobre a empresa (referência interna pra responder com mais precisão — nunca cite isso " +
      `literalmente nem diga "de acordo com meus arquivos"):\n\n${knowledgeText}`;
  }
  if (followUpNudge) systemInstruction += `\n\n${followUpNudge}`;

  const geminiTools = tools.length ? tools.map(toGeminiTool) : undefined;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let needsHuman = false;
  let finalText = "";
  let previousInteractionId: string | undefined;
  let nextInput: unknown = steps;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const interaction = await client.interactions.create({
      model: MODEL,
      system_instruction: systemInstruction,
      input: nextInput as never,
      ...(geminiTools ? { tools: geminiTools } : {}),
      ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
    });

    inputTokens += interaction.usage?.total_input_tokens ?? 0;
    outputTokens += interaction.usage?.total_output_tokens ?? 0;
    cacheReadInputTokens += interaction.usage?.total_cached_tokens ?? 0;

    finalText = interaction.output_text?.trim() ?? "";

    const functionCalls = (interaction.steps ?? []).filter(
      (s): s is Extract<(typeof interaction.steps)[number], { type: "function_call" }> => s.type === "function_call"
    );

    if (interaction.status !== "requires_action" || functionCalls.length === 0) break;

    previousInteractionId = interaction.id;
    const results: Record<string, unknown>[] = [];
    for (const call of functionCalls) {
      let result = "Ferramenta indisponível.";
      if (executeTool) {
        try {
          result = await executeTool(call.name, call.arguments as Record<string, unknown>);
        } catch (err) {
          result = `Erro ao executar ${call.name}: ${(err as Error).message}`;
        }
      }
      if (/PRECISA_HUMANO/i.test(result)) needsHuman = true;
      results.push({ type: "function_result", call_id: call.id, name: call.name, result });
    }
    nextInput = results;
  }

  needsHuman = needsHuman || ATTENTION_TAG.test(finalText);
  const collectedData = parseCollectedData(finalText);
  const stage = parseStage(finalText);
  finalText = finalText.replace(ATTENTION_TAG, "").replace(STATUS_TAG, "").replace(DADOS_TAG, "").trim();

  const replyParts = finalText
    .split(MESSAGE_SPLIT_TAG)
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    replyParts,
    needsHuman,
    collectedData,
    stage,
    inputTokens,
    outputTokens,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens,
  };
}
