import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hitRateLimit } from "@/lib/rate-limit-db";
import { HELP_SYSTEM_PROMPT } from "@/lib/help-knowledge";

// Central de ajuda: a IA responde dúvidas sobre a plataforma. Custo é nosso, então: só usuário logado,
// modelo pequeno, histórico curto e limite por usuário. Nada do workspace entra na conversa.
const MODEL = process.env.HELP_CHAT_MODEL || "claude-haiku-4-5-20251001";
const MAX_HISTORY = 12;
const MAX_CHARS = 1500;
const HOURLY_LIMIT = 40;

type Msg = { role: "user" | "assistant"; content: string };

function parseMessages(raw: unknown): Msg[] | null {
  if (!Array.isArray(raw)) return null;
  const msgs: Msg[] = [];
  for (const m of raw.slice(-MAX_HISTORY)) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim().slice(0, MAX_CHARS);
    if (text) msgs.push({ role, content: text });
  }
  // A API exige começar por "user" e terminar numa pergunta do usuário.
  while (msgs.length > 0 && msgs[0].role !== "user") msgs.shift();
  if (msgs.length === 0 || msgs[msgs.length - 1].role !== "user") return null;
  return msgs;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Faça login para usar a central de ajuda." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { messages?: unknown } | null;
  const messages = parseMessages(body?.messages);
  if (!messages) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });

  const limit = await hitRateLimit(`help-chat:u:${user.id}`, HOURLY_LIMIT, 3600);
  if (!limit.allowed) {
    const minutes = Math.max(1, Math.ceil(limit.retryAfterSeconds / 60));
    return NextResponse.json({ error: `Muitas perguntas seguidas. Tente de novo em ${minutes} minuto(s).` }, { status: 429 });
  }

  try {
    const res = await new Anthropic().messages.create({
      model: MODEL,
      max_tokens: 700,
      system: HELP_SYSTEM_PROMPT,
      messages,
    });
    const reply = res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
    if (!reply) return NextResponse.json({ error: "Não consegui responder agora. Tente reformular a pergunta." }, { status: 502 });
    return NextResponse.json({ reply });
  } catch (err) {
    console.warn("help-chat: falha ao chamar o modelo:", (err as Error).message);
    return NextResponse.json({ error: "A central de ajuda está indisponível no momento. Tente de novo em instantes." }, { status: 502 });
  }
}
