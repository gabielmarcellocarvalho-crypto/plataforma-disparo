import { createHash, timingSafeEqual } from "crypto";

// Comparação de segredo em tempo constante (SECURITY_AUDIT.md #9) — usada nos 4 pontos que autenticam
// por segredo compartilhado (webhooks Evolution/360dialog-metacloud, crons dispatch-campaigns/followups).
// `!==` normal vaza quanto tempo levou até achar o primeiro caractere diferente — teoricamente permite
// descobrir o segredo caractere a caractere (timing attack). Hasheia os dois lados antes de comparar
// (SHA-256, tamanho fixo) em vez de comparar os textos direto — evita lidar com tamanhos diferentes na
// entrada de `timingSafeEqual` (que lança se os buffers não tiverem o mesmo tamanho).
export function secureEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}
