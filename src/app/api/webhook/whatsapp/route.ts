import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMediaBase64, fetchContactProfilePicture } from "@/lib/evolution";
import { transcribeAudio, transcriptionAvailable } from "@/lib/transcribe";
import { runAgentTurn, type Agent, type ResolvedIncoming, type RawIncomingMedia } from "@/lib/agent-turn";
import { type AgentChannel } from "@/lib/agent-channel";
import type { AgentImage } from "@/lib/agent-reply";
import { canAdvanceStage, type ContactStage } from "@/lib/crm-stages";
import { secureEqual } from "@/lib/secure-compare";

const OPT_OUT = /\b(sair|pare|parar|remover|descadastr|n[aã]o quero (mais )?(receber|mensagem)|me tira da lista|stop)\b/i;

// Resposta roda em background após o 200 já ter sido devolvido pra Evolution — mas ainda dentro
// da mesma invocação serverless, incluindo o delay humanizado + a chamada da Anthropic. Aumenta o
// limite padrão da Vercel pra caber isso com folga.
export const maxDuration = 30;

type EvolutionMessage = {
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string };
    audioMessage?: { mimetype?: string };
    imageMessage?: { mimetype?: string; caption?: string };
    videoMessage?: unknown;
    documentMessage?: unknown;
  };
  key?: { remoteJid?: string; fromMe?: boolean; id?: string };
  pushName?: string;
};

function extractText(data?: EvolutionMessage) {
  const msg = data?.message;
  return msg?.conversation || msg?.extendedTextMessage?.text || null;
}

function toSupportedImageType(mimetype: string): AgentImage["mediaType"] {
  if (mimetype.includes("png")) return "image/png";
  if (mimetype.includes("gif")) return "image/gif";
  if (mimetype.includes("webp")) return "image/webp";
  return "image/jpeg"; // WhatsApp manda jpeg na esmagadora maioria dos casos
}

// Resolve o conteúdo da mensagem recebida em algo que o agente consegue usar:
// texto direto, transcrição de áudio (Whisper), ou foto (base64 pra visão do Claude).
// `unsupported` != null quando é um tipo que o agente não processa (vídeo/documento, ou
// áudio sem OPENAI_API_KEY) — nesses casos a conversa vai pra atenção humana. `media` carrega o
// arquivo cru (áudio ou imagem) pra guardar no storage e mostrar depois em Conversas — antes era só
// usado na hora (transcrição/visão) e descartado.
async function resolveIncoming(instanceName: string, data: EvolutionMessage): Promise<ResolvedIncoming> {
  const msg = data.message;
  const messageId = data.key?.id;
  // Dedup de retry/replay do webhook (ver messages.external_id, migration 0045) — passado pro
  // runAgentTurn junto com o resto do conteúdo resolvido, não é um campo separado por acidente.
  const externalId = messageId ?? null;

  const directText = msg?.conversation || msg?.extendedTextMessage?.text || null;
  if (directText) return { text: directText, images: [], unsupported: null, media: null, externalId };

  // Áudio → transcrição. Busca a mídia SEMPRE que houver messageId, mesmo sem transcrição
  // disponível (Whisper indisponível/falhou) — sem isso, o áudio nem aparecia salvo na conversa,
  // só marcava atenção humana sem deixar rastro nenhum pra quem for revisar.
  if (msg?.audioMessage) {
    if (!messageId) return { text: null, images: [], unsupported: "áudio", media: null, externalId };
    const media = await getMediaBase64(instanceName, messageId);
    const transcription = media && transcriptionAvailable() ? await transcribeAudio(media.base64, media.mimetype) : null;
    const rawMedia: RawIncomingMedia | null = media ? { ...media, kind: "audio" } : null;
    if (transcription) return { text: transcription, images: [], unsupported: null, media: rawMedia, externalId };
    return { text: null, images: [], unsupported: "áudio", media: rawMedia, externalId };
  }

  // Imagem → visão
  if (msg?.imageMessage) {
    if (!messageId) return { text: null, images: [], unsupported: "imagem", media: null, externalId };
    const media = await getMediaBase64(instanceName, messageId);
    if (media) {
      const caption = msg.imageMessage.caption || "";
      return {
        text: caption,
        images: [{ base64: media.base64, mediaType: toSupportedImageType(media.mimetype) }],
        unsupported: null,
        media: { ...media, kind: "image" },
        externalId,
      };
    }
    return { text: null, images: [], unsupported: "imagem", media: null, externalId };
  }

  if (msg?.videoMessage) return { text: null, images: [], unsupported: "vídeo", media: null, externalId };
  if (msg?.documentMessage) return { text: null, images: [], unsupported: "documento", media: null, externalId };
  return { text: null, images: [], unsupported: null, media: null, externalId };
}

export async function POST(req: Request) {
  // A Evolution API não assina o payload nem manda header custom — a única forma de
  // autenticar quem chama é um segredo na própria URL do webhook (?secret=...), configurado
  // junto com EVOLUTION_WEBHOOK_URL. Sem isso, qualquer um na internet poderia forjar eventos.
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || !secret || !secureEqual(secret, process.env.WHATSAPP_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Responde já — processa em background sem segurar a conexão da Evolution. Em serverless
  // (Vercel) a invocação pode ser congelada assim que a resposta é enviada, então o processamento
  // de verdade precisa rodar dentro de `after()` pra a plataforma saber que tem que manter a
  // function viva até terminar — um `.catch()` solto sem isso é descartado antes de completar.
  const body = await req.json().catch(() => null);
  after(() => processWebhook(body).catch((err) => console.error("Erro no webhook WhatsApp:", err)));
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
    .select("id, workspace_id, system_prompt, config, status, evolution_instance_name, reply_delay_min_seconds, reply_delay_max_seconds, llm_provider")
    .eq("evolution_instance_name", instanceName)
    .maybeSingle();

  if (agent) {
    const channel: AgentChannel = { kind: "evolution", instanceName };
    const resolved = await resolveIncoming(instanceName, data);
    await runAgentTurn(supabase, agent as Agent, channel, phone, data.pushName ?? null, resolved);
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
    .select("id, photo_url, stage")
    .eq("workspace_id", instance.workspace_id)
    .eq("phone", phone)
    .maybeSingle();
  if (!contact) return; // número fora da base — sem agente de IA aqui, não há o que fazer

  if (!contact.photo_url) {
    const photoUrl = await fetchContactProfilePicture(instanceName, phone);
    if (photoUrl) await supabase.from("contacts").update({ photo_url: photoUrl }).eq("id", contact.id);
  }

  const externalId = data.key?.id ?? null;
  // Mesma dedup de messages.external_id do caminho com agente (migration 0045) — retry/replay não
  // deveria duplicar a mensagem na conversa.
  if (externalId) {
    const { data: dup } = await supabase.from("messages").select("id").eq("workspace_id", instance.workspace_id).eq("external_id", externalId).maybeSingle();
    if (dup) return;
  }

  await supabase.from("messages").insert({
    workspace_id: instance.workspace_id,
    contact_id: contact.id,
    role: "user",
    content: text,
    external_id: externalId,
  });

  if (OPT_OUT.test(text)) {
    await supabase.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
  } else if (canAdvanceStage(contact.stage as ContactStage, "interessado")) {
    // Sem agente de IA lendo a resposta, não tem como classificar o que o lead disse — mas responder
    // já é o sinal mais forte que dá pra captar automaticamente num disparo em massa puro. Avança pra
    // "interessado" (nunca regride, respeitando a ordem normal do funil).
    await supabase.from("contacts").update({ stage: "interessado", stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
  }
}
