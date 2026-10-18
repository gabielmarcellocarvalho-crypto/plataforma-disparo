// Análise de um lead pela IA a partir da conversa: nota 0-100, temperatura, resumo curto e a próxima
// ação sugerida pra equipe. Lógica pura aqui (prompt + validação); a chamada fica em app/actions.

export type Temperature = "quente" | "morno" | "frio";
export type LeadAnalysis = { score: number; temperature: Temperature; summary: string; nextAction: string };

export const ANALYSIS_SYSTEM =
  "Você é um analista comercial. Lê a conversa de WhatsApp entre um lead e a empresa e avalia a chance de " +
  "fechar negócio. Seja objetivo, em português do Brasil. Não invente fatos que não estão na conversa.";

// Últimas mensagens em texto corrido (lead/empresa), cortadas pra não pagar por histórico gigante.
export function conversationTranscript(messages: { role: string; content: string }[], maxChars = 6000): string {
  const lines = messages.map((m) => `${m.role === "user" ? "Lead" : "Empresa"}: ${m.content.replace(/\s+/g, " ").trim()}`);
  let out = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    if (out.length + lines[i].length + 1 > maxChars) break;
    out = `${lines[i]}\n${out}`;
  }
  return out.trim();
}

export function analysisPrompt(transcript: string, stageLabel: string, fields: Record<string, unknown> | null): string {
  const extra = fields && Object.keys(fields).length ? `\nDados do lead: ${JSON.stringify(fields).slice(0, 800)}` : "";
  return (
    `Etapa atual no funil: ${stageLabel}.${extra}\n\nConversa (mais antiga primeiro):\n${transcript || "(sem mensagens)"}\n\n` +
    'Devolva {"score": número 0-100 (chance de fechar), "temperature": "quente"|"morno"|"frio", ' +
    '"summary": "1 a 2 frases: o que o lead quer e em que pé está", "next_action": "1 frase: o que a equipe deve fazer agora"}'
  );
}

export function temperatureFor(score: number): Temperature {
  if (score >= 70) return "quente";
  if (score >= 40) return "morno";
  return "frio";
}

// Valida e normaliza o que veio do modelo; null se não der pra usar.
export function normalizeAnalysis(raw: unknown): LeadAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const score = Math.round(Number(r.score));
  if (!Number.isFinite(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  const t = String(r.temperature || "").toLowerCase();
  const temperature: Temperature = t === "quente" || t === "morno" || t === "frio" ? t : temperatureFor(clamped);
  const summary = String(r.summary || "").trim().slice(0, 400);
  const nextAction = String(r.next_action || r.nextAction || "").trim().slice(0, 240);
  if (!summary) return null;
  return { score: clamped, temperature, summary, nextAction };
}

export const TEMPERATURE_UI: Record<Temperature, { label: string; className: string; icon: string }> = {
  quente: { label: "Quente", className: "bg-danger-soft text-danger", icon: "🔥" },
  morno: { label: "Morno", className: "bg-warning-soft text-warning-text", icon: "☀️" },
  frio: { label: "Frio", className: "bg-info-soft text-info-text", icon: "❄️" },
};
