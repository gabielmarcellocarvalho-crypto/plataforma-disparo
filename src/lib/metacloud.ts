// Conector pra Cloud API direto da Meta — usado pelos números conectados via Embedded Signup (canal
// 'metacloud'), sem o 360dialog como intermediário. Mesmo formato de payload de envio/webhook que
// dialog360.ts (é literalmente a mesma Cloud API), só muda autenticação (Bearer token de System User,
// não D360-API-KEY) e base URL (graph.facebook.com, não o domínio do 360dialog).
//
// Modelo de Tech Provider: 1 token de System User só (META_SYSTEM_USER_TOKEN), da própria conta de
// negócios da AutomaX — não um token por cliente. Depois que o cliente autoriza via Embedded Signup,
// esse token passa a ter permissão de enviar/gerenciar templates no WABA dele automaticamente; o passo
// que efetivamente liga isso é subscribeMetaCloudWebhook (POST /{waba_id}/subscribed_apps).
const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v21.0";
const BASE_URL = `https://graph.facebook.com/${GRAPH_VERSION}`;

function systemUserToken(): string {
  const token = process.env.META_SYSTEM_USER_TOKEN;
  if (!token) throw new Error("META_SYSTEM_USER_TOKEN não configurado.");
  return token;
}

type SendResult = { id: string };

async function post(path: string, body: unknown, token = systemUserToken()): Promise<SendResult> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Meta Graph API respondeu ${res.status}: ${data ? JSON.stringify(data) : await res.text().catch(() => "")}`);
  }
  const id = data?.messages?.[0]?.id;
  if (!id) throw new Error("Meta Graph API não retornou id da mensagem.");
  return { id };
}

// Texto livre — só dentro da janela de 24h após a última mensagem do cliente (regra da Meta, igual
// em qualquer canal oficial). Fora da janela, usa sendMetaCloudTemplate.
export async function sendMetaCloudText(phoneNumberId: string, to: string, body: string): Promise<SendResult> {
  return post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body, preview_url: false },
  });
}

// Template aprovado — obrigatório pra primeira mensagem de um disparo frio (fora da janela de 24h).
export async function sendMetaCloudTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = []
): Promise<SendResult> {
  return post(`/${phoneNumberId}/messages`, {
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

export async function sendMetaCloudMedia(
  phoneNumberId: string,
  to: string,
  kind: "image" | "audio" | "document",
  link: string,
  caption?: string
): Promise<SendResult> {
  return post(`/${phoneNumberId}/messages`, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: kind,
    [kind]: { link, ...(kind !== "audio" && caption ? { caption } : {}) },
  });
}

// Passo obrigatório depois do Embedded Signup: sem isso, o webhook do app (configurado 1x no App
// Dashboard, nível de app — não por cliente) não recebe eventos desse WABA específico.
export async function subscribeMetaCloudWebhook(wabaId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { Authorization: `Bearer ${systemUserToken()}` },
  });
  if (!res.ok) throw new Error(`Falha ao assinar webhook no WABA ${wabaId}: ${res.status} ${await res.text().catch(() => "")}`);
}

// Outro passo obrigatório, separado da assinatura do webhook — sem isso, QUALQUER envio (template,
// texto, mídia) falha com "(#133010) Account not registered", mesmo o número já aparecendo como
// conectado no nosso banco e no Business Manager da Meta. O PIN de verificação em 2 etapas é gerado
// aqui e descartado — não guardamos em lugar nenhum porque nada no fluxo atual precisa dele de novo
// (só seria necessário pra um de-register/re-register manual, que não existe na plataforma ainda).
export async function registerMetaCloudPhone(phoneNumberId: string): Promise<void> {
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const res = await fetch(`${BASE_URL}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${systemUserToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (!res.ok) throw new Error(`Falha ao registrar número na Cloud API: ${res.status} ${await res.text().catch(() => "")}`);
}

// Troca o `code` do Embedded Signup (FB.login com response_type: 'code') por um token — usado só
// como verificação server-side de que o popup foi legítimo (o code prova que veio do fluxo real da
// Meta). O envio em si usa o token de System User, não esse token de curta duração.
export async function exchangeMetaCloudCode(code: string): Promise<void> {
  // NEXT_PUBLIC_META_APP_ID de propósito — o App ID não é segredo (já vai pro navegador de qualquer
  // jeito, é usado no FB.init do botão de conectar), então não faz sentido duplicar numa variável
  // server-only separada. META_APP_SECRET esse sim é sensível e só existe no servidor.
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("NEXT_PUBLIC_META_APP_ID/META_APP_SECRET não configurados.");
  const url = `${BASE_URL}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao validar code do Embedded Signup: ${res.status} ${await res.text().catch(() => "")}`);
}

// Confirma que o token de System User realmente enxerga esse número (prova que o cliente concluiu o
// Embedded Signup de verdade e não é um waba_id/phone_number_id forjado vindo do postMessage do
// navegador) e já aproveita pra trazer o nome/telefone formatado pra exibir na tela.
export type MetaCloudPhoneInfo = { displayPhoneNumber: string | null; verifiedName: string | null };

export async function getMetaCloudPhoneInfo(phoneNumberId: string): Promise<MetaCloudPhoneInfo> {
  const res = await fetch(`${BASE_URL}/${phoneNumberId}?fields=display_phone_number,verified_name`, {
    headers: { Authorization: `Bearer ${systemUserToken()}` },
  });
  if (!res.ok) throw new Error(`Número não encontrado ou sem permissão: ${res.status} ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { display_phone_number?: string; verified_name?: string };
  return { displayPhoneNumber: data.display_phone_number ?? null, verifiedName: data.verified_name ?? null };
}

// Foto de perfil do WhatsApp Business — fluxo em 2 chamadas exigido pela Graph API (Resumable Upload
// API), diferente de mandar mídia numa mensagem normal: (1) abre uma sessão de upload dentro do APP
// (não do WABA/número) informando tamanho e tipo do arquivo, recebendo um id de sessão; (2) manda os
// bytes crus pra essa sessão (auth via header "OAuth", não "Bearer" — a Meta exige esse esquema
// específico aqui) e recebe de volta um "handle" de mídia; só esse handle (não uma URL, não os bytes)
// é aceito pelo endpoint que efetivamente troca a foto do número.
// As 2 primeiras chamadas (sessão + upload) exigem especificamente um APP access token (client_id|
// client_secret, não o token de System User) — é assim que a documentação da Resumable Upload API
// pede; só a última chamada (aplicar no perfil do número) usa o token de System User de sempre.
export async function updateMetaCloudProfilePhoto(phoneNumberId: string, fileBytes: Buffer, mimeType: string): Promise<void> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) throw new Error("NEXT_PUBLIC_META_APP_ID/META_APP_SECRET não configurados.");
  const appToken = `${appId}|${appSecret}`;

  const sessionRes = await fetch(`${BASE_URL}/${appId}/uploads?file_length=${fileBytes.length}&file_type=${encodeURIComponent(mimeType)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${appToken}` },
  });
  const sessionData = (await sessionRes.json().catch(() => null)) as { id?: string } | null;
  if (!sessionRes.ok || !sessionData?.id) {
    throw new Error(`Falha ao abrir upload da foto: ${sessionRes.status} ${sessionData ? JSON.stringify(sessionData) : ""}`);
  }

  const uploadRes = await fetch(`${BASE_URL}/${sessionData.id}`, {
    method: "POST",
    headers: { Authorization: `OAuth ${appToken}`, file_offset: "0" },
    body: new Uint8Array(fileBytes),
  });
  const uploadData = (await uploadRes.json().catch(() => null)) as { h?: string } | null;
  if (!uploadRes.ok || !uploadData?.h) {
    throw new Error(`Falha ao enviar a foto: ${uploadRes.status} ${uploadData ? JSON.stringify(uploadData) : ""}`);
  }

  const profileRes = await fetch(`${BASE_URL}/${phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    headers: { Authorization: `Bearer ${systemUserToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", profile_picture_handle: uploadData.h }),
  });
  if (!profileRes.ok) {
    throw new Error(`Falha ao aplicar a foto no perfil do WhatsApp: ${profileRes.status} ${await profileRes.text().catch(() => "")}`);
  }
}

// Foto atual, direto da Meta (não guardamos cópia própria) — usado só pra exibir na tela de
// Configurações antes/depois da troca.
export async function getMetaCloudProfilePhotoUrl(phoneNumberId: string): Promise<string | null> {
  const res = await fetch(`${BASE_URL}/${phoneNumberId}/whatsapp_business_profile?fields=profile_picture_url`, {
    headers: { Authorization: `Bearer ${systemUserToken()}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { data?: Array<{ profile_picture_url?: string }> } | null;
  return data?.data?.[0]?.profile_picture_url ?? null;
}

// Lista os Message Templates aprovados desse WABA — mesmo papel do listDialog360Templates, usado pro
// seletor de template na criação de campanha.
export type MetaCloudTemplate = {
  name: string;
  language: string;
  category: string;
  bodyText: string | null;
  bodyVarCount: number;
};

export async function listMetaCloudTemplates(wabaId: string): Promise<MetaCloudTemplate[]> {
  const res = await fetch(`${BASE_URL}/${wabaId}/message_templates?limit=1000&fields=name,language,category,status,components`, {
    headers: { Authorization: `Bearer ${systemUserToken()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meta Graph API respondeu ${res.status} ao listar templates.`);
  const data = (await res.json()) as {
    data?: Array<{
      name: string;
      language: string;
      category: string;
      status: string;
      components?: Array<{ type: string; text?: string }>;
    }>;
  };
  return (data.data || [])
    .filter((t) => t.status === "APPROVED")
    .map((t) => {
      const bodyText = t.components?.find((c) => c.type === "BODY")?.text ?? null;
      const bodyVarCount = bodyText ? new Set([...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])).size : 0;
      return { name: t.name, language: t.language, category: t.category, bodyText, bodyVarCount };
    });
}
