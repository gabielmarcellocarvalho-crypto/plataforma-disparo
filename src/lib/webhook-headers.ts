// Cabeçalhos da ação "Chamar webhook" das automações (ex.: token_exact da Exact Sales, Authorization de
// outro CRM). O valor é segredo: chega em texto só no momento de salvar, é cifrado no servidor e o
// navegador passa a ver apenas que existe um valor salvo — nunca o valor de volta.
import { decryptToken, encryptToken } from "@/lib/calendar/crypto";

export type WebhookHeader = { name: string; value?: string; value_enc?: string };

// Cabeçalhos que o próprio fetch controla; deixar a automação mexer só quebra a chamada.
const RESERVED = new Set(["host", "content-length", "connection", "transfer-encoding", "content-type"]);

export const MAX_WEBHOOK_HEADERS = 5;

// Nome aceito pelas APIs inclui sublinhado (token_exact): HTTP permite, então a validação também.
const NAME_OK = /^[A-Za-z0-9_-]{1,64}$/;

export function validateHeaders(headers: WebhookHeader[] | undefined): string | null {
  const list = headers ?? [];
  if (list.length > MAX_WEBHOOK_HEADERS) return `No máximo ${MAX_WEBHOOK_HEADERS} cabeçalhos por chamada.`;
  for (const h of list) {
    const n = (h.name || "").trim();
    if (!NAME_OK.test(n)) return `Nome de cabeçalho inválido: "${n}". Use letras, números, hífen ou sublinhado.`;
    if (RESERVED.has(n.toLowerCase())) return `O cabeçalho "${n}" é definido automaticamente.`;
    if (!h.value && !h.value_enc) return `Preencha o valor do cabeçalho "${n}".`;
  }
  return null;
}

// Na hora de salvar: valor novo em texto é cifrado; sem valor novo, mantém o cifrado que já existia.
export function sealHeaders(headers: WebhookHeader[] | undefined): WebhookHeader[] {
  return (headers ?? []).map((h) => ({
    name: h.name.trim(),
    value_enc: h.value ? encryptToken(h.value) : h.value_enc,
  }));
}

// Na hora de chamar: abre os valores. Cabeçalho que não abre (chave trocada) fica de fora e a chamada segue.
export function openHeaders(headers: WebhookHeader[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    if (!h.name || !h.value_enc) continue;
    try {
      out[h.name] = decryptToken(h.value_enc);
    } catch {
      // segue sem esse cabeçalho; a API do outro lado responde com erro de autenticação e isso aparece no histórico
    }
  }
  return out;
}

// O que vai pro navegador: só o nome e se há valor salvo.
export function maskHeaders(headers: WebhookHeader[] | undefined): WebhookHeader[] {
  return (headers ?? []).map((h) => ({ name: h.name, value_enc: h.value_enc ? "salvo" : undefined }));
}
