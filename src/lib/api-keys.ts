import { randomBytes, createHash } from "crypto";

// Prefixo identifica visualmente que é uma chave da plataforma (facilita reconhecer em logs/configs
// de terceiros) sem revelar nada sobre o segredo em si.
const KEY_PREFIX = "orb_";

export function generateApiKey(): { plain: string; displayPrefix: string; hash: string } {
  const plain = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { plain, displayPrefix: plain.slice(0, 12), hash: hashApiKey(plain) };
}

export function hashApiKey(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}
