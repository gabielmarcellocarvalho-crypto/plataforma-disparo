import { NextResponse, after } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendText, sendMedia, getMediaBase64 } from "@/lib/evolution";
import { generateReply, type ConversationMessage, type AgentImage, type ToolExecutor } from "@/lib/agent-reply";
import { transcribeAudio, transcriptionAvailable } from "@/lib/transcribe";
import { normalizeAgentConfig } from "@/lib/agent-prompt";

// Ferramentas disponíveis pro agente. `enviar_foto` já funciona ponta a ponta (biblioteca de
// mídia por agente). gerar_link_pagamento e consultar_disponibilidade são os pontos de
// integração externa por cliente (gateway de pagamento / PMS) — adicionar como novas tools aqui.
// A lista de pastas (categorias) entra na descrição pra o modelo escolher uma que existe de fato,
// junto com a nota de "quando usar" configurada no formulário do agente (varia muito por agente).
function buildAgentTools(categories: string[], folderNotes: Record<string, string>): Anthropic.Tool[] {
  const listado = categories.map((c) => (folderNotes[c] ? `${c} (usar quando: ${folderNotes[c]})` : c)).join("; ");
  return [
    {
      name: "enviar_arquivo",
      description:
        "Envia um ou mais arquivos (fotos ou documentos/PDF) pro cliente no WhatsApp. Use quando o " +
        "cliente pedir pra ver algo (fotos de quartos/áreas, cardápio, tabela de pacotes em PDF, etc.) " +
        "ou quando mostrar o arquivo ajudar a converter. " +
        `Pastas disponíveis: ${listado}. ` +
        "Passe em 'categoria' exatamente o nome de uma dessas pastas. Não prometa arquivo de pasta que não existe na lista.",
      input_schema: {
        type: "object",
        properties: {
          categoria: { type: "string", description: "Uma das pastas de arquivos disponíveis", enum: categories },
        },
        required: ["categoria"],
      },
    },
  ];
}

// Universal (qualquer agente com biblioteca de mídia): nunca reenvia o mesmo arquivo pro mesmo
// contato duas vezes na conversa — registra em contact_media_sent o que já foi mandado.
function makeToolExecutor(supabase: AdminClient, agent: Agent, phone: string, contactId: string): ToolExecutor {
  return async (name, input) => {
    if (name === "enviar_arquivo") {
      const categoria = String(input.categoria || "").trim();
      if (!categoria) return "Informe qual categoria de arquivo enviar.";
      const { data: media } = await supabase
        .from("agent_media")
        .select("id, url, caption, category, media_type, file_name")
        .eq("agent_id", agent.id)
        .ilike("category", `%${categoria}%`)
        .limit(20);
      if (!media || media.length === 0) {
        return `Nenhum arquivo cadastrado para "${categoria}". Não invente que enviou; ofereça outra opção ou diga que vai verificar.`;
      }

      const { data: sentRows } = await supabase
        .from("contact_media_sent")
        .select("agent_media_id")
        .eq("contact_id", contactId)
        .in(
          "agent_media_id",
          media.map((m) => m.id)
        );
      const alreadySent = new Set((sentRows || []).map((r) => r.agent_media_id));
      const novos = media.filter((m) => !alreadySent.has(m.id)).slice(0, 5);

      if (novos.length === 0) {
        return `Todos os arquivos da pasta "${categoria}" já foram enviados antes nessa mesma conversa. Não envie de novo — se o cliente pedir de novo, diga que já mandou antes.`;
      }

      for (const m of novos) {
        const mediatype = m.media_type === "document" ? "document" : "image";
        await sendMedia(agent.evolution_instance_name, phone, m.url, {
          caption: m.caption || undefined,
          mediatype,
          fileName: m.file_name || undefined,
        }).catch((e) => console.error("Erro ao enviar arquivo:", e));
      }
      await supabase.from("contact_media_sent").upsert(novos.map((m) => ({ contact_id: contactId, agent_media_id: m.id })));

      const puladas = media.length - novos.length;
      return (
        `${novos.length} arquivo(s) novo(s) da categoria "${categoria}" enviado(s) ao cliente.` +
        (puladas > 0 ? ` (${puladas} já tinham sido enviados antes nessa conversa e foram pulados.)` : "")
      );
    }
    return `Ferramenta "${name}" não implementada.`;
  };
}

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
// áudio sem OPENAI_API_KEY) — nesses casos a conversa vai pra atenção humana.
async function resolveIncoming(
  instanceName: string,
  data: EvolutionMessage
): Promise<{ text: string | null; images: AgentImage[]; unsupported: string | null }> {
  const msg = data.message;
  const messageId = data.key?.id;

  const directText = msg?.conversation || msg?.extendedTextMessage?.text || null;
  if (directText) return { text: directText, images: [], unsupported: null };

  // Áudio → transcrição
  if (msg?.audioMessage) {
    if (!messageId || !transcriptionAvailable()) return { text: null, images: [], unsupported: "áudio" };
    const media = await getMediaBase64(instanceName, messageId);
    const transcription = media ? await transcribeAudio(media.base64, media.mimetype) : null;
    if (transcription) return { text: transcription, images: [], unsupported: null };
    return { text: null, images: [], unsupported: "áudio" };
  }

  // Imagem → visão
  if (msg?.imageMessage) {
    if (!messageId) return { text: null, images: [], unsupported: "imagem" };
    const media = await getMediaBase64(instanceName, messageId);
    if (media) {
      const caption = msg.imageMessage.caption || "";
      return {
        text: caption,
        images: [{ base64: media.base64, mediaType: toSupportedImageType(media.mimetype) }],
        unsupported: null,
      };
    }
    return { text: null, images: [], unsupported: "imagem" };
  }

  if (msg?.videoMessage) return { text: null, images: [], unsupported: "vídeo" };
  if (msg?.documentMessage) return { text: null, images: [], unsupported: "documento" };
  return { text: null, images: [], unsupported: null };
}

export async function POST(req: Request) {
  // A Evolution API não assina o payload nem manda header custom — a única forma de
  // autenticar quem chama é um segredo na própria URL do webhook (?secret=...), configurado
  // junto com EVOLUTION_WEBHOOK_URL. Sem isso, qualquer um na internet poderia forjar eventos.
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
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
    .select("id, workspace_id, system_prompt, config, status, evolution_instance_name, reply_delay_min_seconds, reply_delay_max_seconds")
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
  config: unknown;
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

  const { text, images, unsupported } = await resolveIncoming(agent.evolution_instance_name, data);

  if (!text && images.length === 0) {
    if (unsupported) {
      await supabase
        .from("contacts")
        .update({ needs_attention: true, attention_reason: `Enviou ${unsupported}, o agente não conseguiu processar automaticamente.` })
        .eq("id", contact.id);
    }
    return;
  }

  // Foto sem legenda ainda precisa virar uma linha de texto no histórico — o modelo recebe a
  // imagem de fato via `images`, mas o registro guarda um marcador legível pra revisão humana.
  const userContent = text || "[o cliente enviou uma foto]";

  await supabase.from("messages").insert({
    workspace_id: agent.workspace_id,
    contact_id: contact.id,
    agent_id: agent.id,
    role: "user",
    content: userContent,
  });

  if (text && OPT_OUT.test(text)) {
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

  // Pastas de fotos cadastradas pra esse agente — só habilita a ferramenta de foto se houver
  // alguma (agente sem fotos, tipo o da Hanoi, roda sem tools, igual antes).
  const { data: mediaCats } = await supabase.from("agent_media").select("category").eq("agent_id", agent.id);
  const categories = [...new Set((mediaCats || []).map((m) => m.category))];
  const { mediaFolderNotes } = normalizeAgentConfig(agent.config);
  const tools = categories.length ? buildAgentTools(categories, mediaFolderNotes) : [];
  const executor = categories.length ? makeToolExecutor(supabase, agent, phone, contact.id) : undefined;

  const { data: knowledgeRows } = await supabase.from("agent_knowledge").select("file_name, content").eq("agent_id", agent.id);
  const knowledgeText = knowledgeRows?.length
    ? knowledgeRows.map((k) => `### ${k.file_name}\n${k.content}`).join("\n\n---\n\n")
    : undefined;

  const { reply, needsHuman, collectedData, inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens } = await generateReply(
    agent.system_prompt,
    { name: contact.name, custom_fields: contact.custom_fields },
    history,
    images,
    tools,
    executor,
    knowledgeText
  );

  if (Object.keys(collectedData).length) {
    const merged = { ...((contact.custom_fields as Record<string, unknown>) || {}), ...collectedData };
    await supabase.from("contacts").update({ custom_fields: merged }).eq("id", contact.id);
  }

  if (reply) {
    // O agente respondeu — não marca atenção humana mesmo que ele tenha sido cauteloso no texto.
    // "Precisa de atenção" fica só pros casos em que ele realmente NÃO conseguiu responder (abaixo).
    await supabase.from("messages").insert({
      workspace_id: agent.workspace_id,
      contact_id: contact.id,
      agent_id: agent.id,
      role: "assistant",
      content: reply,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationInputTokens,
      cache_read_input_tokens: cacheReadInputTokens,
    });

    // O agente sinalizou [[PRECISA_HUMANO]] mas continuou respondendo normalmente (nunca revela isso
    // ao cliente) — só acende um alerta em Conversas pra equipe revisar, sem mutar o agente.
    if (needsHuman) {
      await supabase
        .from("contacts")
        .update({ flagged_reason: "O agente sinalizou que essa conversa pode precisar de atenção humana." })
        .eq("id", contact.id);
    }

    // Delay humanizado antes de responder — evita a sensação de bot respondendo instantâneo.
    const { reply_delay_min_seconds: min, reply_delay_max_seconds: max } = agent;
    const delaySeconds = min + Math.random() * Math.max(0, max - min);
    await sleep(delaySeconds * 1000);

    await sendText(agent.evolution_instance_name, phone, reply).catch((err) =>
      console.error("Erro ao enviar resposta do agente:", err)
    );
  } else {
    // Só aqui é atenção humana de verdade: o agente não produziu nenhuma resposta.
    await supabase
      .from("contacts")
      .update({ needs_attention: true, attention_reason: "O agente não conseguiu responder automaticamente essa mensagem." })
      .eq("id", contact.id);
  }
}
