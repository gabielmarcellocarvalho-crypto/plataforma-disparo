// Coexistência: o mesmo número no app WhatsApp Business (celular) e na Cloud API (plataforma). A Meta
// manda dois tipos de evento que não existem num número só da API:
//   - smb_message_echoes: mensagem que alguém mandou PELO CELULAR (sem isso, a conversa na plataforma
//     fica pela metade e o agente de IA responde por cima de quem já está atendendo);
//   - history: até 180 dias de conversas antigas, enviado uma vez depois da conexão.
// Aqui só se transforma o payload em linhas simples; gravar fica com o webhook.

export type CoexMessage = {
  phoneNumberId: string;
  customerPhone: string;
  fromBusiness: boolean;
  externalId: string;
  createdAt: string; // ISO
  content: string;
  kind: "echo" | "history";
};

type RawMsg = {
  from?: string;
  to?: string;
  id?: string;
  timestamp?: string | number;
  type?: string;
  text?: { body?: string };
  image?: { caption?: string };
  video?: { caption?: string };
  document?: { caption?: string; filename?: string };
};

type RawValue = {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  message_echoes?: RawMsg[];
  history?: { threads?: { id?: string; messages?: RawMsg[] }[] }[];
};

type RawBody = { entry?: { changes?: { field?: string; value?: RawValue }[] }[] };

const MEDIA_LABEL: Record<string, string> = {
  image: "imagem",
  video: "vídeo",
  document: "documento",
  audio: "áudio",
  sticker: "figurinha",
  media_placeholder: "mídia",
};

// Texto que aparece na conversa. Mídia vira marcador (o arquivo não vem no evento); apagar/editar não vira mensagem.
function contentOf(m: RawMsg): string | null {
  if (m.type === "revoke" || m.type === "edit") return null;
  if (m.type === "text") return m.text?.body?.trim() || null;
  const label = m.type ? MEDIA_LABEL[m.type] : undefined;
  if (!label) return null;
  const caption = (m.image?.caption || m.video?.caption || m.document?.caption || "").trim();
  return caption ? `[${label}] ${caption}` : `[${label}]`;
}

function toIso(ts: string | number | undefined): string {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : new Date().toISOString();
}

const digits = (v: string | undefined) => (v || "").replace(/\D/g, "");

export function parseCoexistenceMessages(body: unknown): CoexMessage[] {
  const out: CoexMessage[] = [];
  for (const entry of (body as RawBody | null)?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value;
      const phoneNumberId = value?.metadata?.phone_number_id;
      if (!value || !phoneNumberId) continue;

      if (change.field === "smb_message_echoes") {
        for (const m of value.message_echoes || []) {
          const content = contentOf(m);
          if (!content || !m.id || !m.to) continue;
          out.push({ phoneNumberId, customerPhone: digits(m.to), fromBusiness: true, externalId: m.id, createdAt: toIso(m.timestamp), content, kind: "echo" });
        }
      }

      if (change.field === "history") {
        for (const h of value.history || []) {
          for (const thread of h.threads || []) {
            const customer = digits(thread.id);
            if (!customer) continue;
            for (const m of thread.messages || []) {
              const content = contentOf(m);
              if (!content || !m.id) continue;
              // Do cliente quando `from` é o próprio número da conversa; o resto saiu do negócio.
              const fromBusiness = digits(m.from) !== customer;
              out.push({ phoneNumberId, customerPhone: customer, fromBusiness, externalId: m.id, createdAt: toIso(m.timestamp), content, kind: "history" });
            }
          }
        }
      }
    }
  }
  return out;
}
