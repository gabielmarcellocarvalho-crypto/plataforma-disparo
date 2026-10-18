import { GoogleGenAI } from "@google/genai";

// Chamadas curtas de IA fora da conversa do agente (análise de lead, insights): sempre no Gemini Flash,
// o modelo mais barato que a plataforma já usa — ver custo estimado em pricing-calculator.ts.
const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL = process.env.GEMINI_LIGHT_MODEL || process.env.GEMINI_MODEL || "gemini-3-flash-preview";

export const LIGHT_MODEL = MODEL;

// Pede uma resposta em JSON e devolve o objeto (null se o modelo não devolveu JSON válido) junto com os
// tokens gastos — quem chama registra o consumo em ai_usage (entra no custo de IA de Métricas).
export async function askJson<T>(system: string, prompt: string): Promise<{ data: T | null; inputTokens: number; outputTokens: number }> {
  const interaction = await client.interactions.create({
    model: MODEL,
    system_instruction: `${system}\n\nResponda SOMENTE com um JSON válido, sem texto antes ou depois e sem bloco de código.`,
    input: [{ type: "user_input", content: [{ type: "text", text: prompt }] }] as never,
  });
  return {
    data: parseJsonLoose<T>(interaction.output_text ?? ""),
    inputTokens: interaction.usage?.total_input_tokens ?? 0,
    outputTokens: interaction.usage?.total_output_tokens ?? 0,
  };
}

// Tolera o modelo embrulhar o JSON em ```json … ``` ou escrever algo antes.
export function parseJsonLoose<T>(raw: string): T | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const end = text.lastIndexOf(open === "{" ? "}" : "]");
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
