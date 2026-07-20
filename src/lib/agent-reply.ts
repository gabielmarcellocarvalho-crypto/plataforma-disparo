import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

const ATTENTION_TAG = /\[\[PRECISA_HUMANO\]\]/i;

export type ConversationMessage = { role: "user" | "assistant"; content: string };

export type AgentReplyContact = {
  name: string | null;
  custom_fields: Record<string, unknown> | null;
};

export type AgentReply = { reply: string; needsHuman: boolean };

// Gera a resposta do agente pra uma mensagem recebida, dado o prompt configurado pro agente
// e o histórico de conversa já salvo com esse contato.
export async function generateReply(
  systemPrompt: string,
  contact: AgentReplyContact,
  history: ConversationMessage[]
): Promise<AgentReply> {
  const camposExtras = contact.custom_fields && Object.keys(contact.custom_fields).length
    ? ` Dados adicionais: ${JSON.stringify(contact.custom_fields)}.`
    : "";
  const contactContext = `Dados do contato: nome="${contact.name || "desconhecido"}".${camposExtras}`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `<contexto>${contactContext}</contexto>` },
    { role: "assistant", content: "Entendido, vou conduzir a conversa com esse contato." },
    ...history,
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages,
  });

  if (response.stop_reason === "refusal") {
    return { reply: "Vou confirmar isso com a equipe e já retorno.", needsHuman: true };
  }

  let text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  const needsHuman = ATTENTION_TAG.test(text);
  if (needsHuman) text = text.replace(ATTENTION_TAG, "").trim();

  return { reply: text, needsHuman };
}
