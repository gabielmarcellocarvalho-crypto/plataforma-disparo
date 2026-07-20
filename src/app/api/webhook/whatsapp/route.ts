import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText } from "@/lib/evolution";
import { generateReply, type ConversationMessage } from "@/lib/agent-reply";

const OPT_OUT = /\b(sair|pare|parar|remover|descadastr|n[aã]o quero (mais )?(receber|mensagem)|me tira da lista|stop)\b/i;
const HISTORY_LIMIT = 20;

// Resposta roda em background após o 200 já ter sido devolvido pra Evolution — mas ainda dentro
// da mesma invocação serverless, incluindo o delay humanizado + a chamada da Anthropic. Aumenta o
// limite padrão da Vercel pra caber isso com folga.
export const maxDuration = 30;

type EvolutionMessage = {
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    audioMessage?: unknown;
    imageMessage?: unknown;
    videoMessage?: unknown;
    documentMessage?: unknown;
  };
  key?: { remoteJid?: string; fromMe?: boolean };
  pushName?: string;
};

function extractText(data?: EvolutionMessage) {
  const msg = data?.message;
  return msg?.conversation || msg?.extendedTextMessage?.text || null;
}

function unsupportedMediaType(data?: EvolutionMessage) {
  const msg = data?.message;
  if (!msg) return null;
  if (msg.audioMessage) return "áudio";
  if (msg.imageMessage) return "imagem";
  if (msg.videoMessage) return "vídeo";
  if (msg.documentMessage) return "documento";
  return null;
}

export async function POST(req: Request) {
  // A Evolution API não assina o payload nem manda header custom — a única forma de
  // autenticar quem chama é um segredo na própria URL do webhook (?secret=...), configurado
  // junto com EVOLUTION_WEBHOOK_URL. Sem isso, qualquer um na internet poderia forjar eventos.
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Responde já — processa em background sem segurar a conexão da Evolution.
  const body = await req.json().catch(() => null);
  processWebhook(body).catch((err) => console.error("Erro no webhook WhatsApp:", err));
  return NextResponse.json({ ok: true });
}

async function processWebhook(body: {
  event?: string;
  instance?: string;
  data?: EvolutionMessage;
} | null) {
  if (!body) return;
  const event = (body.event || "").toLowerCase().replace(/_/g, ".");
  if (event !== "messages.upsert") return;

  const data = body.data;
  if (!data || data.key?.fromMe) return;
  const jid = data.key?.remoteJid || "";
  if (!jid.endsWith("@s.whatsapp.net")) return;

  const phone = jid.split("@")[0].replace(/\D/g, "");
  const instanceName = body.instance;
  if (!instanceName) return;

  const supabase = createAdminClient();

  const { data: agent } = await supabase
    .from("agents")
    .select("id, workspace_id, system_prompt, status, evolution_instance_name, reply_delay_min_seconds, reply_delay_max_seconds")
    .eq("evolution_instance_name", instanceName)
    .maybeSingle();

  if (agent) {
    await handleAgentMessage(supabase, agent, phone, data);
    return;
  }

  // Não é instância de agente — trata como número de disparo em massa (sem IA), só registra e checa opt-out.
  const { data: instance } = await supabase
    .from("whatsapp_instances")
    .select("workspace_id")
    .eq("instance_name", instanceName)
    .maybeSingle();
  if (!instance) return;

  const text = extractText(data);
  if (!text) return;

  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", instance.workspace_id)
    .eq("phone", phone)
    .maybeSingle();
  if (!contact) return; // número fora da base — sem agente de IA aqui, não há o que fazer

  await supabase.from("messages").insert({
    workspace_id: instance.workspace_id,
    contact_id: contact.id,
    role: "user",
    content: text,
  });

  if (OPT_OUT.test(text)) {
    await supabase.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AdminClient = ReturnType<typeof createAdminClient>;
type Agent = {
  id: string;
  workspace_id: string;
  system_prompt: string;
  status: string;
  evolution_instance_name: string;
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
};

async function handleAgentMessage(supabase: AdminClient, agent: Agent, phone: string, data: EvolutionMessage) {
  // Contato pode ser um lead novo chegando pelo agente — cria se não existir.
  let { data: contact } = await supabase
    .from("contacts")
    .select("id, name, custom_fields, opt_out_whatsapp, needs_attention")
    .eq("workspace_id", agent.workspace_id)
    .eq("phone", phone)
    .maybeSingle();

  if (!contact) {
    const { data: created } = await supabase
      .from("contacts")
      .insert({ workspace_id: agent.workspace_id, phone, name: data.pushName || null })
      .select("id, name, custom_fields, opt_out_whatsapp, needs_attention")
      .maybeSingle();
    contact = created;
  }
  if (!contact) return;

  if (contact.opt_out_whatsapp) return;

  const text = extractText(data);
  const unsupported = unsupportedMediaType(data);

  if (!text) {
    if (unsupported) {
      await supabase
        .from("contacts")
        .update({ needs_attention: true, attention_reason: `Enviou ${unsupported}, o agente não consegue processar esse tipo de mensagem.` })
        .eq("id", contact.id);
    }
    return;
  }

  await supabase.from("messages").insert({
    workspace_id: agent.workspace_id,
    contact_id: contact.id,
    agent_id: agent.id,
    role: "user",
    content: text,
  });

  if (OPT_OUT.test(text)) {
    await supabase.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
    return;
  }

  if (contact.needs_attention) return; // humano já assumiu essa conversa — agente não responde até ser resolvido
  if (agent.status !== "ativo") return;

  const { data: historyRows } = await supabase
    .from("messages")
    .select("role, content")
    .eq("agent_id", agent.id)
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const history: ConversationMessage[] = (historyRows || [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

  const { reply, needsHuman, inputTokens, outputTokens } = await generateReply(
    agent.system_prompt,
    { name: contact.name, custom_fields: contact.custom_fields },
    history
  );

  if (reply) {
    await supabase.from("messages").insert({
      workspace_id: agent.workspace_id,
      contact_id: contact.id,
      agent_id: agent.id,
      role: "assistant",
      content: reply,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    });

    // Delay humanizado antes de responder — evita a sensação de bot respondendo instantâneo.
    const { reply_delay_min_seconds: min, reply_delay_max_seconds: max } = agent;
    const delaySeconds = min + Math.random() * Math.max(0, max - min);
    await sleep(delaySeconds * 1000);

    await sendText(agent.evolution_instance_name, phone, reply).catch((err) =>
      console.error("Erro ao enviar resposta do agente:", err)
    );
  }

  if (needsHuman) {
    await supabase
      .from("contacts")
      .update({ needs_attention: true, attention_reason: "O agente sinalizou que precisa de atenção humana nessa conversa." })
      .eq("id", contact.id);
  }
}
