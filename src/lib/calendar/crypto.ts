import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

// Cifra o refresh token do Google antes de ir pro banco (AES-256-GCM). A chave (`CALENDAR_TOKEN_KEY`,
// 32 bytes em base64) existe só nas variáveis de ambiente da Vercel/local — com o banco vazado, o
// token sozinho não abre a agenda de ninguém. Formato gravado: iv.tag.cifrado, cada parte em base64url.

function keyFrom(raw: string | undefined): Buffer {
  const key = Buffer.from(raw || "", "base64");
  if (key.length !== 32) throw new Error("CALENDAR_TOKEN_KEY ausente ou inválida (precisa de 32 bytes em base64).");
  return key;
}

export function encryptToken(plain: string, rawKey: string | undefined = process.env.CALENDAR_TOKEN_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(rawKey), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decryptToken(stored: string, rawKey: string | undefined = process.env.CALENDAR_TOKEN_KEY): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !enc) throw new Error("Token cifrado em formato inválido.");
  const decipher = createDecipheriv("aes-256-gcm", keyFrom(rawKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
