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
        }>;
        statuses?: Array<{ id?: string; status?: string; recipient_id?: string; timestamp?: string }>;
      };
    }>;
  }>;
};

export type Dialog360IncomingMessage = { phoneNumberId: string; from: string; text: string; contactName: string | null };

// Extrai só as mensagens de texto recebidas (ignora status de entrega/leitura e outros tipos de
// mídia por ora — mesmo escopo do MVP de disparo avulso, sem IA, só texto).
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
        if (m.type !== "text" || !m.from || !m.text?.body) continue;
        out.push({ phoneNumberId, from: m.from, text: m.text.body, contactName: nameByWaId.get(m.from) ?? null });
      }
    }
  }
  return out;
}
