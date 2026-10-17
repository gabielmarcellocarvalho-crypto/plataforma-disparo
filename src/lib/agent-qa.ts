import type Anthropic from "@anthropic-ai/sdk";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

// Perguntas do agente pra equipe + FAQ (tabela agent_qa, migration 0087). O agente só fala "não sei,
// vou confirmar com a equipe" e registra a pergunta; a resposta que a equipe dá vira memória dele.
export const QA_TOOL_NAMES = new Set(["perguntar_equipe"]);

const MAX_MEMORY_ROWS = 200;
const MAX_MEMORY_CHARS = 20_000;

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function sameQuestion(a: string, b: string): boolean {
  const x = fold(a);
  return x.length > 0 && x === fold(b);
}

export type QaMemory = { available: boolean; text: string | undefined };

// Respostas já dadas (e FAQ manual) deste agente, em texto pro prompt. `available` false = tabela ainda
// não existe (migration pendente) → o agente roda como sempre, sem a ferramenta nem o bloco.
export async function loadQaMemory(supabase: AdminClient, agentId: string): Promise<QaMemory> {
  const { data, error } = await supabase
    .from("agent_qa")
    .select("question, answer")
    .eq("agent_id", agentId)
    .eq("status", "respondida")
    .not("answer", "is", null)
    .order("answered_at", { ascending: false })
    .limit(MAX_MEMORY_ROWS);
  if (error) return { available: false, text: undefined };
  let text = "";
  for (const r of data || []) {
    const block = `P: ${r.question}\nR: ${r.answer}\n\n`;
    if (text.length + block.length > MAX_MEMORY_CHARS) break;
    text += block;
  }
  return { available: true, text: text.trim() || undefined };
}

export function qaPromptBlock(memory: string | undefined, askEnabled = true): string {
  const ask = askEnabled
    ? "\n\nQuando o cliente perguntar algo que você não sabe responder com certeza (não está nas suas instruções, no material de " +
    "estudo, nas respostas da equipe abaixo nem nas ferramentas), NÃO invente nem responda por responder. Diga ao cliente, de " +
    "forma natural, que você não tem essa informação agora e vai confirmar com a equipe, e chame a ferramenta perguntar_equipe " +
    "com a pergunta escrita de forma clara e completa (sem dados pessoais do cliente). Depois siga a conversa normalmente."
    : "";
  const known = memory
    ? "\n\nRespostas já dadas pela equipe (use como verdade; se a pergunta do cliente estiver aqui, responda direto" +
      (askEnabled ? ", sem perguntar de novo" : "") +
      "):\n" +
      memory
    : "";
  return ask + known;
}

export function buildQaTools(): Anthropic.Tool[] {
  return [
    {
      name: "perguntar_equipe",
      description:
        "Registra uma dúvida que você não sabe responder, para a equipe responder depois. Use só quando faltar informação de " +
        "verdade. Escreva a pergunta de forma geral e completa, para servir também a outros clientes.",
      input_schema: {
        type: "object",
        properties: { pergunta: { type: "string", description: "A dúvida, clara e completa" } },
        required: ["pergunta"],
      },
    },
  ];
}

export function makeQaExecutor(supabase: AdminClient, agent: { id: string; workspace_id: string }, contactId: string) {
  return async (name: string, input: Record<string, unknown>): Promise<string> => {
    if (name !== "perguntar_equipe") return `Ferramenta "${name}" não implementada.`;
    const pergunta = String(input.pergunta ?? "").trim().slice(0, 500);
    if (pergunta.length < 5) return "Pergunta vazia. Escreva a dúvida completa.";

    const { data: existing } = await supabase
      .from("agent_qa")
      .select("question, answer, status")
      .eq("agent_id", agent.id)
      .in("status", ["pendente", "respondida"])
      .order("created_at", { ascending: false })
      .limit(300);
    const dup = (existing || []).find((r) => sameQuestion(r.question as string, pergunta));
    if (dup?.status === "respondida" && dup.answer) {
      return `A equipe já respondeu isso: ${dup.answer}\nResponda ao cliente com essa informação.`;
    }
    if (dup) return "Essa dúvida já foi enviada à equipe. Diga ao cliente que você vai confirmar e retorna em breve. Não invente.";

    const { error } = await supabase
      .from("agent_qa")
      .insert({ workspace_id: agent.workspace_id, agent_id: agent.id, contact_id: contactId, question: pergunta, source: "agente" });
    if (error) return "Não foi possível registrar a dúvida agora. Diga ao cliente que vai confirmar e retorna em breve. Não invente.";
    return "Dúvida enviada à equipe. Diga ao cliente que você vai confirmar e retorna em breve. Não invente a resposta.";
  };
}
