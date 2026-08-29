// Conector pra API oficial do WhatsApp via 360dialog (BSP) — mesma Cloud API da Meta, o 360dialog só
// repassa. Alternativa ao Evolution API (src/lib/evolution.ts) pra número de disparo em massa sem IA
// (whatsapp_instances.channel = '360dialog'). Formato confirmado na doc oficial (docs.360dialog.com),
// não chutado — mas AINDA NÃO TESTADO contra uma conta/API key real, validar antes de confiar em produção.
const BASE_URL = process.env.DIALOG360_BASE_URL || "https://waba-v2.360dialog.io";

type SendResult = { id: string };

async function post(apiKey: string, path: string, body: unknown): Promise<SendResult> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`360dialog respondeu ${res.status}: ${data ? JSON.stringify(data) : await res.text().catch(() => "")}`);
  }
  const id = data?.messages?.[0]?.id;
  if (!id) throw new Error("360dialog não retornou id da mensagem.");
  return { id };
}

// Texto livre — só funciona dentro da janela de 24h após a última mensagem do cliente (é a mesma
// regra da Meta pra qualquer canal oficial). Fora da janela, a Meta rejeita — use sendDialog360Template.
export async function sendDialog360Text(apiKey: string, to: string, body: string): Promise<SendResult> {
  return post(apiKey, "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

// Mensagem de template aprovado pela Meta — obrigatória pra primeira mensagem de um disparo (lead
// frio, fora da janela de 24h). `bodyParams` preenche as variáveis {{1}}, {{2}}... do corpo do template,
// na ordem. Deixe vazio se o template não tem variável nenhuma.
export async function sendDialog360Template(
  apiKey: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = []
): Promise<SendResult> {
  return post(apiKey, "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(bodyParams.length
        ? { components: [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }] }
        : {}),
    },
  });
}

// Mídia (imagem/áudio/documento) via link público — só funciona dentro da janela de 24h, igual
// texto livre (fora da janela a Meta exige template, e template não carrega mídia arbitrária).
export async function sendDialog360Media(
  apiKey: string,
  to: string,
  kind: "image" | "audio" | "document",
  link: string,
  caption?: string
): Promise<SendResult> {
  return post(apiKey, "/messages", {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: kind,
    [kind]: { link, ...(kind !== "audio" && caption ? { caption } : {}) },
  });
}

// Registra a URL de webhook desse canal no 360dialog — chamar uma vez ao cadastrar o número (via
// script/curl manual com a API key real, não pela UI ainda). Endpoint tirado da doc oficial; como o
// 360dialog tem variações de versão de API, VALIDAR contra a conta real antes de depender disso.
export async function setDialog360Webhook(apiKey: string, url: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/v1/configs/webhook`, {
    method: "POST",
    headers: { "D360-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Falha ao configurar webhook no 360dialog: ${res.status} ${await res.text().catch(() => "")}`);
}

// Baixa uma mídia recebida (áudio/imagem) — mesmo fluxo em 2 passos de qualquer Cloud API: primeiro
// pega a URL temporária/assinada a partir do id, depois baixa os bytes de fato dessa URL (as duas
// chamadas usam a MESMA API key do 360dialog, diferente da Meta direto que usa Bearer). Base64 pra
// caber no mesmo formato que Evolution já usa (getMediaBase64) — assim runAgentTurn/transcribeAudio
// funcionam igual pros 2 canais.
export async function getDialog360Media(apiKey: string, mediaId: string): Promise<{ base64: string; mimetype: string } | null> {
  try {
    const metaRes = await fetch(`${BASE_URL}/${mediaId}`, { headers: { "D360-API-KEY": apiKey } });
    if (!metaRes.ok) return null;
    const meta = (await metaRes.json()) as { url?: string; mime_type?: string };
    if (!meta.url) return null;

    const fileRes = await fetch(meta.url, { headers: { "D360-API-KEY": apiKey } });
    if (!fileRes.ok) return null;
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    return { base64: buffer.toString("base64"), mimetype: meta.mime_type || fileRes.headers.get("content-type") || "application/octet-stream" };
  } catch {
    return null; // best-effort — sem mídia não pode travar o resto do webhook
  }
}

// Lista os Message Templates aprovados da conta (WABA) ligada a essa API key — usado pra popular o
// seletor de template na criação de campanha, em vez do cliente digitar o nome de cabeça (e errar).
// Endpoint confirmado contra conta real (2026-08-18): GET /v1/configs/templates. Templates criados
// direto no Meta Business Manager só aparecem aqui depois de sincronizados no Hub do 360dialog
// ("Synchronise templates with Meta") — se vier vazio, é o primeiro lugar a checar.
export type Dialog360Template = {
  name: string;
  language: string;
  category: string;
  bodyText: string | null;
  bodyVarCount: number; // quantas variáveis {{1}}, {{2}}... o corpo tem
};

export async function listDialog360Templates(apiKey: string): Promise<Dialog360Template[]> {
  const res = await fetch(`${BASE_URL}/v1/configs/templates?limit=1000`, {
    headers: { "D360-API-KEY": apiKey },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`360dialog respondeu ${res.status} ao listar templates.`);
  const data = (await res.json()) as {
    waba_templates?: Array<{
      name: string;
      language: string;
      category: string;
      status: string;
      components?: Array<{ type: string; text?: string }>;
    }>;
  };
  return (data.waba_templates || [])
    .filter((t) => t.status === "approved")
    .map((t) => {
      const bodyText = t.components?.find((c) => c.type === "BODY")?.text ?? null;
      const bodyVarCount = bodyText ? new Set([...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size : 0;
      return { name: t.name, language: t.language, category: t.category, bodyText, bodyVarCount };
    });
}

// ── Formato do webhook recebido (Cloud API / Meta) ────────────────────────────────────────────
// Confirmado na doc oficial do 360dialog — é o mesmo formato padrão da Cloud API da Meta.
export type Dialog360WebhookBody = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          type?: string;
          text?: { body?: string };
          audio?: { id?: string; mime_type?: string };
          image?: { id?: string; mime_type?: string; caption?: string };
        }>;
        statuses?: Array<{ id?: string; status?: string; recipient_id?: string; timestamp?: string }>;
      };
    }>;
  }>;
};

// "other" cobre vídeo/documento/figurinha/localização etc — tipos que o agente ainda não processa,
// mas que precisam chegar até runAgentTurn pra virar handoff pra humano (em vez de só sumir sem
// deixar rastro nenhum, como acontecia antes de "text"/"audio"/"image" serem os únicos reconhecidos).
export type Dialog360IncomingMessage = {
  phoneNumberId: string;
  from: string;
  contactName: string | null;
  type: "text" | "audio" | "image" | "other";
  text: string | null; // corpo (texto) ou legenda (imagem) — null pra áudio/outros
  mediaId: string | null;
  mimeType: string | null;
  // wamid da Meta — único por mensagem, usado pra dedup (retry/replay do webhook não deveria gerar 2ª
  // resposta do agente nem cobrar o LLM 2x pela mesma mensagem, ver messages.external_id).
  messageId: string | null;
};

// Extrai as mensagens recebidas — texto, áudio e imagem viram entrada pro agente (runAgentTurn
// resolve a mídia de fato); outros tipos passam como "other" só pra sinalizar handoff, sem mídia.
export function parseDialog360IncomingMessages(body: Dialog360WebhookBody): Dialog360IncomingMessage[] {
  const out: Dialog360IncomingMessage[] = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value) continue;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;
      const nameByWaId = new Map((value.contacts || []).map((c) => [c.wa_id, c.profile?.name || null]));
      for (const m of value.messages || []) {
        if (!m.from) continue;
        const contactName = nameByWaId.get(m.from) ?? null;
        const base = { phoneNumberId, from: m.from, contactName, messageId: m.id || null };
        if (m.type === "text" && m.text?.body) {
          out.push({ ...base, type: "text", text: m.text.body, mediaId: null, mimeType: null });
        } else if (m.type === "audio" && m.audio?.id) {
          out.push({ ...base, type: "audio", text: null, mediaId: m.audio.id, mimeType: m.audio.mime_type || null });
        } else if (m.type === "image" && m.image?.id) {
          out.push({ ...base, type: "image", text: m.image.caption || null, mediaId: m.image.id, mimeType: m.image.mime_type || null });
        } else if (m.type) {
          out.push({ ...base, type: "other", text: null, mediaId: null, mimeType: null });
        }
      }
    }
  }
  return out;
}
