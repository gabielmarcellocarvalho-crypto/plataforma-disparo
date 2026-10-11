import { createHmac } from "crypto";
import { secureEqual } from "@/lib/secure-compare";

// Assinatura dos webhooks da Meta: o cabeçalho `X-Hub-Signature-256` traz `sha256=<HMAC-SHA256 do corpo
// BRUTO usando o App Secret>`. Quem não tem o App Secret não consegue forjar um evento, mesmo sabendo a
// URL e o segredo de query string do webhook.
export function verifyMetaSignature(rawBody: string, header: string | null | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  return secureEqual(header.trim(), expected);
}

// "enforce": evento de número da Meta sem assinatura válida é descartado. Qualquer outro valor (padrão):
// só registra o aviso e segue — modo de observação, pra confirmar nos logs que o App Secret configurado
// é o mesmo que assina antes de passar a exigir (exigir com o segredo errado calaria todos os números).
export function metaSignatureMode(env: string | undefined = process.env.META_WEBHOOK_SIGNATURE): "enforce" | "observe" {
  return env === "enforce" ? "enforce" : "observe";
}
