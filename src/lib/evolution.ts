// Cliente da Evolution API — adaptado do piloto da Hanoi, agora com instância nomeada por workspace.
const EVOLUTION_URL = (process.env.EVOLUTION_URL || "").replace(/\/$/, "");
const EVOLUTION_APIKEY = process.env.EVOLUTION_APIKEY || "";
const WEBHOOK_URL = process.env.EVOLUTION_WEBHOOK_URL || "";

class EvolutionError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(method: string, path: string, body?: unknown) {
  if (!EVOLUTION_URL || !EVOLUTION_APIKEY) {
    throw new Error("EVOLUTION_URL/EVOLUTION_APIKEY não configurados.");
  }
  const res = await fetch(`${EVOLUTION_URL}${path}`, {
    method,
    headers: { "Content-Type": "application/json", apikey: EVOLUTION_APIKEY },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new EvolutionError(res.status, `Evolution API ${res.status} em ${path}: ${text.slice(0, 300)}`);
  return data;
}

// Nome de instância determinístico e curto a partir do id do workspace (número de disparo em massa).
export function instanceNameFor(workspaceId: string) {
  return `ws-${workspaceId.slice(0, 8)}`;
}

// Nome de instância determinístico a partir do id do agente (número próprio do agente de IA).
export function agentInstanceNameFor(agentId: string) {
  return `agent-${agentId.slice(0, 8)}`;
}

export async function createInstance(instanceName: string): Promise<{ qrcodeBase64: string | null }> {
  try {
    const created = (await request("POST", "/instance/create", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    })) as { qrcode?: { base64?: string } };
    return { qrcodeBase64: created?.qrcode?.base64 ?? null };
  } catch (err) {
    if (err instanceof EvolutionError && (err.status === 403 || /already in use|already exists/i.test(err.message))) {
      return { qrcodeBase64: null }; // já existe — segue pro connect/QR normal
    }
    throw err;
  }
}

export async function setWebhook(instanceName: string) {
  if (!WEBHOOK_URL) return;
  await request("POST", `/webhook/set/${instanceName}`, {
    webhook: {
      enabled: true,
      url: WEBHOOK_URL,
      webhookByEvents: false,
      webhookBase64: false,
      events: ["MESSAGES_UPSERT"],
    },
  });
}

export async function connectionState(instanceName: string): Promise<string> {
  const state = (await request("GET", `/instance/connectionState/${instanceName}`)) as {
    instance?: { state?: string };
  };
  return state?.instance?.state || "desconhecido";
}

// Pega um QR code novo (instância já criada mas ainda não conectada/QR expirado).
export async function fetchQrCode(instanceName: string): Promise<string | null> {
  const res = (await request("GET", `/instance/connect/${instanceName}`)) as { base64?: string };
  return res?.base64 ?? null;
}

export async function sendText(instanceName: string, number: string, text: string) {
  return request("POST", `/message/sendText/${instanceName}`, { number, text, delay: 1200 });
}

// Envia mídia (foto de quarto, etc.) — `media` pode ser uma URL pública ou base64.
export async function sendMedia(
  instanceName: string,
  number: string,
  media: string,
  opts?: { caption?: string; mediatype?: "image" | "video" | "document" | "audio"; fileName?: string }
) {
  return request("POST", `/message/sendMedia/${instanceName}`, {
    number,
    mediatype: opts?.mediatype || "image",
    media,
    caption: opts?.caption,
    fileName: opts?.fileName,
    delay: 1200,
  });
}

// Baixa a mídia recebida (áudio/imagem) em base64, a partir do id da mensagem no webhook.
// Usado pra transcrever áudio (Whisper) e pra passar fotos pro modelo (visão).
// Timeout curto: se a Evolution não consegue recuperar a mídia, é melhor falhar rápido (cai pra
// atenção humana) do que segurar a função serverless até estourar o maxDuration.
export async function getMediaBase64(
  instanceName: string,
  messageId: string
): Promise<{ base64: string; mimetype: string } | null> {
  if (!EVOLUTION_URL || !EVOLUTION_APIKEY) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${EVOLUTION_URL}/chat/getBase64FromMediaMessage/${instanceName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVOLUTION_APIKEY },
      body: JSON.stringify({ message: { key: { id: messageId } }, convertToMp4: false }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`getBase64FromMediaMessage ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = (await res.json()) as { base64?: string; mimetype?: string };
    if (!data?.base64) return null;
    return { base64: data.base64, mimetype: data.mimetype || "application/octet-stream" };
  } catch (err) {
    console.error("Erro ao baixar mídia da Evolution:", (err as Error).message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Detalhes da instância — usado pra descobrir o número conectado (ownerJid) e a foto de perfil
// do WhatsApp depois do QR escaneado (ou pra detectar se a pessoa trocou de foto).
export async function fetchInstanceInfo(
  instanceName: string
): Promise<{ connectionStatus: string; phoneNumber: string | null; photoUrl: string | null }> {
  const res = (await request("GET", `/instance/fetchInstances?instanceName=${instanceName}`)) as Array<{
    connectionStatus?: string;
    ownerJid?: string | null;
    profilePicUrl?: string | null;
  }>;
  const info = res?.[0];
  const phoneNumber = info?.ownerJid ? info.ownerJid.split("@")[0].replace(/\D/g, "") : null;
  return {
    connectionStatus: info?.connectionStatus || "desconhecido",
    phoneNumber,
    photoUrl: info?.profilePicUrl || null,
  };
}
