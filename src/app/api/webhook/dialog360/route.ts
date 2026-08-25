import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDialog360IncomingMessages, type Dialog360WebhookBody } from "@/lib/dialog360";
import { runAgentTurn, type Agent } from "@/lib/agent-turn";
import { type AgentChannel } from "@/lib/agent-channel";
import { brPhoneVariant } from "@/lib/import-contacts";

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
export const maxDuration = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && token && token === process.env.WHATSAPP_WEBHOOK_SECRET && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (!process.env.WHATSAPP_WEBHOOK_SECRET || secret !== process.env.WHATSAPP_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as Dialog360WebhookBody | null;
  after(() => processDialog360Webhook(body).catch((err) => console.error("Erro no webhook 360dialog:", err)));
  return NextResponse.json({ ok: true });
}

async function processDialog360Webhook(body: Dialog360WebhookBody | null) {
  if (!body) return;
  const incoming = parseDialog360IncomingMessages(body);

  // Rede de segurança pro canal metacloud (Tech Provider direto): esse endpoint foi validado contra o
  // formato real do 360dialog, mas nunca recebeu um evento de verdade vindo direto da Meta ainda. Se
  // chegar um payload com entry/changes mas o parser não extrair nenhuma mensagem, loga o corpo bruto —
  // sem isso, uma mudança de formato passaria batido (a Meta sempre responde 200 aqui, não teria erro
  // visível em lugar nenhum, só mensagem "sumida" silenciosamente).
  if (incoming.length === 0 && (body.entry?.length ?? 0) > 0) {
    console.warn("Webhook 360dialog/metacloud: payload com entry mas 0 mensagens extraídas —", JSON.stringify(body).slice(0, 2000));
  }

  if (incoming.length === 0) return;

  const supabase = createAdminClient();

  for (const msg of incoming) {
    const { data: instance } = await supabase
      .from("whatsapp_instances")
      .select("id, workspace_id, channel, dialog360_api_key")
      .eq("phone_number_id", msg.phoneNumberId)
      .maybeSingle();
    if (!instance) continue; // número não cadastrado em nenhum workspace — ignora

    // Número com agente de IA vinculado (1 número servindo disparo + SDR, ex.: campanha manda o
    // template e o mesmo número depois conduz a conversa) — passa pro núcleo compartilhado do agente
    // em vez de só logar. Sem agente vinculado, segue o comportamento de sempre (linha abaixo).
    const { data: agentRow } = await supabase
      .from("agents")
      .select("id, workspace_id, system_prompt, config, status, evolution_instance_name, reply_delay_min_seconds, reply_delay_max_seconds, llm_provider")
      .eq("whatsapp_instance_id", instance.id)
      .maybeSingle();

    if (agentRow) {
      const channel: AgentChannel =
        instance.channel === "360dialog"
          ? { kind: "360dialog", apiKey: instance.dialog360_api_key || "" }
          : { kind: "metacloud", phoneNumberId: msg.phoneNumberId };
      if (channel.kind === "360dialog" && !channel.apiKey) continue; // instância mal configurada — não dá pra responder
      await runAgentTurn(supabase, agentRow as Agent, channel, msg.from, msg.contactName, {
        text: msg.text,
        images: [],
        unsupported: null,
        media: null,
      });
      continue;
    }

    let { data: contact } = await supabase.from("contacts").select("id").eq("workspace_id", instance.workspace_id).eq("phone", msg.from).maybeSingle();
    if (!contact) {
      // Mesmo fallback do 9º dígito usado em runAgentTurn — sem isso, a resposta de um lead de
      // campanha (número salvo num formato, Meta reportando no outro) fica órfã silenciosamente aqui.
      const variant = brPhoneVariant(msg.from);
      if (variant) {
        const { data: byVariant } = await supabase.from("contacts").select("id").eq("workspace_id", instance.workspace_id).eq("phone", variant).maybeSingle();
        contact = byVariant;
      }
    }
    if (!contact) continue; // número fora da base — sem agente aqui, não há o que fazer

    await supabase.from("messages").insert({
      workspace_id: instance.workspace_id,
      contact_id: contact.id,
      role: "user",
      content: msg.text,
    });
  }
}
