import { NextResponse, after } from "next/server";
import { saveAdReferral } from "@/lib/ad-referral";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDialog360IncomingMessages, getDialog360Media, type Dialog360WebhookBody, type Dialog360IncomingMessage } from "@/lib/dialog360";
import { getMetaCloudMedia } from "@/lib/metacloud";
import { uploadConversationMedia } from "@/lib/conversation-media";
import { transcribeAudio, transcriptionAvailable } from "@/lib/transcribe";
import { runAgentTurn, AGENT_COLUMNS, type Agent, type ResolvedIncoming, type RawIncomingMedia } from "@/lib/agent-turn";
import { type AgentChannel } from "@/lib/agent-channel";
import { brPhoneVariant } from "@/lib/import-contacts";
import type { AgentImage } from "@/lib/agent-reply";
import { canAdvanceStage, type ContactStage } from "@/lib/crm-stages";
import { createInboundLead } from "@/lib/inbound-lead";
import { secureEqual } from "@/lib/secure-compare";
import { metaSignatureMode, verifyMetaSignature } from "@/lib/meta-signature";
import { handleChatbotInbound, inboundMediaPlaceholder } from "@/lib/chatbot-engine";
import { parseTemplateCategoryChanges, saveTemplateCategoryChanges } from "@/lib/meta-template-events";

const OPT_OUT = /\b(sair|pare|parar|remover|descadastr|n[aã]o quero (mais )?(receber|mensagem)|me tira da lista|stop)\b/i;

function toSupportedImageType(mimetype: string): AgentImage["mediaType"] {
  if (mimetype.includes("png")) return "image/png";
  if (mimetype.includes("gif")) return "image/gif";
  if (mimetype.includes("webp")) return "image/webp";
  return "image/jpeg"; // WhatsApp manda jpeg na esmagadora maioria dos casos
}

// Mesmo papel do resolveIncoming do Evolution (src/app/api/webhook/whatsapp/route.ts), só que buscando
// a mídia pelo canal certo (360dialog usa D360-API-KEY, metacloud usa Bearer do System User) — o
// resultado (texto/transcrição/visão/handoff) é o mesmo `ResolvedIncoming` que runAgentTurn já espera,
// então o núcleo da conversa nem sabe de qual canal oficial a mensagem veio.
async function resolveOfficialIncoming(
  instance: { channel: string; dialog360_api_key: string | null },
  msg: Dialog360IncomingMessage
): Promise<ResolvedIncoming> {
  // Dedup de retry/replay do webhook (ver messages.external_id, migration 0045).
  const externalId = msg.messageId;

  if (msg.type === "text") return { text: msg.text, images: [], unsupported: null, media: null, externalId };

  if (msg.type === "audio" || msg.type === "image") {
    if (!msg.mediaId) return { text: null, images: [], unsupported: msg.type === "audio" ? "áudio" : "imagem", media: null, externalId };
    const media =
      instance.channel === "360dialog" ? await getDialog360Media(instance.dialog360_api_key || "", msg.mediaId) : await getMetaCloudMedia(msg.mediaId);

    if (msg.type === "image") {
      if (!media) return { text: null, images: [], unsupported: "imagem", media: null, externalId };
      return {
        text: msg.text || "",
        images: [{ base64: media.base64, mediaType: toSupportedImageType(media.mimetype) }],
        unsupported: null,
        media: { ...media, kind: "image" },
        externalId,
      };
    }

    const transcription = media && transcriptionAvailable() ? await transcribeAudio(media.base64, media.mimetype) : null;
    const rawMedia: RawIncomingMedia | null = media ? { ...media, kind: "audio" } : null;
    if (transcription) return { text: transcription, images: [], unsupported: null, media: rawMedia, externalId };
    return { text: null, images: [], unsupported: "áudio", media: rawMedia, externalId };
  }

  // Figurinha e reação são resposta social, não pedido — o lead manda um joinha e pronto. Marcar
  // isso como "arquivo que o agente não leu" tirava o agente da conversa a cada figurinha. Segue
  // como não processado (não dá pra responder a um sticker), mas sem passar a conversa pro humano.
  if (msg.rawType === "sticker" || msg.rawType === "reaction") {
    const nome = msg.rawType === "sticker" ? "figurinha" : "reação";
    return { text: null, images: [], unsupported: nome, media: null, externalId, ignorable: true };
  }

  return { text: null, images: [], unsupported: "arquivo", media: null, externalId };
}

// Imagem, áudio e documento recebidos num número SEM agente: baixa pelo canal certo e sobe pro bucket,
// pra a tela de Conversas mostrar. Best-effort — se falhar, a mensagem entra só como texto marcador.
async function saveIncomingMedia(
  supabase: ReturnType<typeof createAdminClient>,
  instance: { workspace_id: string; channel: string; dialog360_api_key: string | null },
  msg: Dialog360IncomingMessage
): Promise<{ url: string; kind: "image" | "audio" | "document"; caption: string | null } | null> {
  const kind = msg.type === "image" ? "image" : msg.type === "audio" ? "audio" : msg.rawType === "document" ? "document" : null;
  if (!kind || !msg.mediaId) return null;
  try {
    const file =
      instance.channel === "360dialog" ? await getDialog360Media(instance.dialog360_api_key || "", msg.mediaId) : await getMetaCloudMedia(msg.mediaId);
    if (!file) return null;
    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("workspace_id", instance.workspace_id)
      .in("phone", [msg.from, brPhoneVariant(msg.from) ?? msg.from])
      .maybeSingle();
    // Contato novo ainda não existe aqui: sobe sob o workspace com pasta própria do telefone.
    const url = await uploadConversationMedia(supabase, instance.workspace_id, contact?.id ?? `novo-${msg.from}`, file.base64, file.mimetype);
    return url ? { url, kind, caption: msg.text } : null;
  } catch (err) {
    console.error("Falha ao guardar mídia recebida:", err instanceof Error ? err.message : err);
    return null;
  }
}

// Webhook da API oficial (Cloud API da Meta) — rota separada da do Evolution porque o formato do
// payload é completamente diferente (não é o formato da Evolution/Baileys). Serve os DOIS canais
// oficiais: 360dialog (BSP, repassa o payload como recebe) e metacloud (Tech Provider direto) — o
// formato de entry/changes/value é idêntico nos dois, e o lookup abaixo já é por phone_number_id
// (channel-agnóstico), então não precisa de rota nem lógica separada por canal.
//
// GET é a verificação de assinatura que a Meta faz 1x, na hora de salvar a URL no App Dashboard
// (nível de app — 1 assinatura só cobre todos os WABAs conectados via Embedded Signup). 360dialog não
// usa esse handshake (registra a URL via API, não pela tela) — o handler GET só entra em ação pro
// canal metacloud, mas não atrapalha o 360dialog em nada.
// A resposta do agente roda dentro desta invocação: delay humanizado + chamada ao LLM + envio. O teto
// da função é 300s (plano pago, Fluid Compute) e o delay do agente é limitado a 120s em
// MAX_REPLY_DELAY_SECONDS (actions/agents.ts), deixando 180s pro LLM e o envio. Os dois andam juntos.
export const maxDuration = 300;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && challenge && process.env.WHATSAPP_WEBHOOK_SECRET && secureEqual(token, process.env.WHATSAPP_WEBHOOK_SECRET)) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || !secret || !secureEqual(secret, process.env.WHATSAPP_WEBHOOK_SECRET)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // O segredo da URL é o mesmo pra todos os clientes e aparece em logs/painéis; a Meta, além dele, assina o
  // corpo com o App Secret (X-Hub-Signature-256), e isso ninguém forja sem a chave. Lê o corpo BRUTO
  // (a assinatura é sobre os bytes exatos) e só depois interpreta o JSON.
  const raw = await req.text().catch(() => "");
  const body = (() => {
    try {
      return JSON.parse(raw) as Dialog360WebhookBody;
    } catch {
      return null;
    }
  })();
  const signedByMeta = verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET);
  const enforce = metaSignatureMode() === "enforce";
  // Número da Meta sem assinatura válida só é descartado em modo "enforce"; no modo de observação (padrão)
  // segue como antes e o aviso nos logs mostra se a assinatura está chegando e batendo.
  const metaTrusted = signedByMeta || !enforce;
  if (!signedByMeta) console.warn(`Webhook WhatsApp sem assinatura Meta válida (modo ${enforce ? "enforce" : "observação"}; cabeçalho ${req.headers.get("x-hub-signature-256") ? "presente" : "ausente"}).`);

  after(() => processDialog360Webhook(body, metaTrusted).catch((err) => console.error("Erro no webhook 360dialog:", err)));
  // Mesmo endpoint recebe a reclassificação de template da Meta (field template_category_update) — evento
  // que só a Meta manda, então exige a assinatura quando o modo for "enforce".
  if (metaTrusted) {
    after(() => saveTemplateCategoryChanges(createAdminClient(), parseTemplateCategoryChanges(body)).catch((err) => console.error("Erro no alerta de template:", err)));
  }
  return NextResponse.json({ ok: true });
}

async function processDialog360Webhook(body: Dialog360WebhookBody | null, metaTrusted: boolean) {
  if (!body) return;
  const incoming = parseDialog360IncomingMessages(body);

  // Rede de segurança pro canal metacloud (Tech Provider direto): esse endpoint foi validado contra o
  // formato real do 360dialog, mas nunca recebeu um evento de verdade vindo direto da Meta ainda. Se
  // chegar um payload com entry/changes mas o parser não extrair nenhuma mensagem, loga o corpo bruto —
  // sem isso, uma mudança de formato passaria batido (a Meta sempre responde 200 aqui, não teria erro
  // visível em lugar nenhum, só mensagem "sumida" silenciosamente).
  if (incoming.length === 0 && (body.entry?.length ?? 0) > 0) {
    // Só a forma do payload, nunca o conteúdo: o corpo tem telefone e texto de cliente (LGPD).
    const shape = body.entry?.map((e) => ({ changes: (e as { changes?: { field?: string }[] }).changes?.map((c) => c.field) }));
    console.warn("Webhook 360dialog/metacloud: payload com entry mas 0 mensagens extraídas —", JSON.stringify(shape).slice(0, 500));
  }

  if (incoming.length === 0) return;

  const supabase = createAdminClient();

  for (const msg of incoming) {
    // Coluna `chatbot` (migration 0077) com rede de segurança: se ainda não existir, refaz sem ela em
    // vez de perder a mensagem — sem isso, deploy antes da migration calaria todo número sem IA.
    let { data: instance, error: instanceError } = await supabase
      .from("whatsapp_instances")
      .select("id, workspace_id, channel, dialog360_api_key, chatbot")
      .eq("phone_number_id", msg.phoneNumberId)
      .maybeSingle();
    if (instanceError) {
      const retry = await supabase
        .from("whatsapp_instances")
        .select("id, workspace_id, channel, dialog360_api_key")
        .eq("phone_number_id", msg.phoneNumberId)
        .maybeSingle();
      instance = retry.data ? { ...retry.data, chatbot: null } : null;
    }
    if (!instance) continue; // número não cadastrado em nenhum workspace — ignora

    // Número da Meta direta exige assinatura válida (no modo "enforce"). O 360dialog não assina com o App
    // Secret da Meta, então continua valendo só o segredo da URL pra ele.
    if (instance.channel === "metacloud" && !metaTrusted) {
      console.warn("Webhook Meta descartado: assinatura inválida ou ausente.");
      continue;
    }

    // Clique em anúncio Click-to-WhatsApp: abre a janela de 72h grátis pra este contato (cobrança da Meta).
    if (msg.referral) {
      await supabase.from("contacts").update({ ctwa_at: new Date().toISOString() }).eq("workspace_id", instance.workspace_id).eq("phone", msg.from);
    }

    // Número com agente de IA vinculado (1 número servindo disparo + SDR, ex.: campanha manda o
    // template e o mesmo número depois conduz a conversa) — passa pro núcleo compartilhado do agente
    // em vez de só logar. Sem agente vinculado, segue o comportamento de sempre (linha abaixo).
    const { data: agentRow } = await supabase
      .from("agents")
      .select(AGENT_COLUMNS)
      .eq("whatsapp_instance_id", instance.id)
      .maybeSingle();

    if (agentRow) {
      const channel: AgentChannel =
        instance.channel === "360dialog"
          ? { kind: "360dialog", apiKey: instance.dialog360_api_key || "" }
          : { kind: "metacloud", phoneNumberId: msg.phoneNumberId };
      if (channel.kind === "360dialog" && !channel.apiKey) continue; // instância mal configurada — não dá pra responder
      const resolved = { ...(await resolveOfficialIncoming(instance, msg)), ad: msg.referral ? msg.ad : undefined };
      await runAgentTurn(supabase, agentRow as Agent, channel, msg.from, msg.contactName, resolved);
      continue;
    }

    // Sem agente ninguém lê a mídia, mas ela precisa aparecer na conversa: baixa e guarda no bucket antes de registrar.
    const media = await saveIncomingMedia(supabase, instance, msg);

    // Chatbot de mensagens iniciais (número sem IA, com o bot ligado). Cuidou da mensagem = para aqui.
    const handledByBot = await handleChatbotInbound(
      supabase,
      { ...instance, instance_name: null, phone_number_id: msg.phoneNumberId },
      { phone: msg.from, pushName: msg.contactName, text: msg.type === "text" ? msg.text : null, externalId: msg.messageId, media }
    ).catch((err) => {
      console.error("Chatbot (360dialog/metacloud) falhou:", err instanceof Error ? err.message : err);
      return false;
    });
    if (handledByBot) continue;

    let { data: contact } = await supabase.from("contacts").select("id, stage").eq("workspace_id", instance.workspace_id).eq("phone", msg.from).maybeSingle();
    if (!contact) {
      // Mesmo fallback do 9º dígito usado em runAgentTurn — sem isso, a resposta de um lead de
      // campanha (número salvo num formato, Meta reportando no outro) fica órfã silenciosamente aqui.
      const variant = brPhoneVariant(msg.from);
      if (variant) {
        const { data: byVariant } = await supabase.from("contacts").select("id, stage").eq("workspace_id", instance.workspace_id).eq("phone", variant).maybeSingle();
        contact = byVariant;
      }
    }
    let createdNow = false;
    if (!contact) {
      // Número novo que escreveu primeiro (sem agente neste número): vira contato já em andamento
      // ("abordado") e a mensagem entra em Conversas, em vez de sumir.
      const created = await createInboundLead(supabase, {
        workspaceId: instance.workspace_id,
        instanceId: instance.id,
        phone: msg.from,
        name: msg.contactName ?? null,
        optOut: OPT_OUT.test(msg.text || ""),
      });
      contact = created ? { id: created.id, stage: created.stage } : null;
      createdNow = Boolean(created);
    }
    if (!contact) continue;
    if (msg.referral) await saveAdReferral(supabase, contact.id, msg.ad);
    const text = msg.type === "text" ? msg.text : null;
    if (!text && !media) continue; // figurinha, reação, vídeo: sem o que mostrar na conversa

    // Mesma dedup de messages.external_id do caminho com agente (migration 0045) — retry/replay do
    // webhook não deveria duplicar a mensagem na conversa nem reprocessar o avanço de fase abaixo.
    if (msg.messageId) {
      const { data: dup } = await supabase
        .from("messages")
        .select("id")
        .eq("workspace_id", instance.workspace_id)
        .eq("external_id", msg.messageId)
        .maybeSingle();
      if (dup) continue;
    }

    await supabase.from("messages").insert({
      workspace_id: instance.workspace_id,
      contact_id: contact.id,
      role: "user",
      content: text ?? media?.caption ?? inboundMediaPlaceholder(media?.kind),
      external_id: msg.messageId,
      ...(media ? { media_url: media.url, media_type: media.kind } : {}),
    });

    if (text && OPT_OUT.test(text)) {
      await supabase.from("contacts").update({ opt_out_whatsapp: true }).eq("id", contact.id);
    } else if (!createdNow && canAdvanceStage(contact.stage as ContactStage, "interessado")) {
      // Sem agente de IA lendo a resposta, não tem como classificar o que o lead disse — mas
      // responder já é o sinal mais forte que dá pra captar automaticamente num disparo em massa
      // puro. Avança pra "interessado" (nunca regride, respeitando a ordem normal do funil).
      await supabase.from("contacts").update({ stage: "interessado", stage_changed_at: new Date().toISOString() }).eq("id", contact.id);
    }
  }
}
