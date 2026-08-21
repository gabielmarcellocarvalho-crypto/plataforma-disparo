import { createHmac } from "crypto";

// Assina o link de descadastro de e-mail sem precisar de sessão de usuário nem guardar token no
// banco — o token é derivado do próprio contact_id + segredo, então validar é só recalcular e
// comparar. Baixo risco de segurança de propósito (pior caso de forjar é descadastrar outro contato
// do mesmo jeito que ele mesmo poderia pedir), não protege dado sensível nenhum.
const SECRET = process.env.UNSUBSCRIBE_SECRET || "";

export function unsubscribeToken(contactId: string): string {
  return createHmac("sha256", SECRET).update(contactId).digest("hex").slice(0, 24);
}

export function verifyUnsubscribeToken(contactId: string, token: string): boolean {
  return Boolean(SECRET) && token === unsubscribeToken(contactId);
}

export function unsubscribeUrl(siteOrigin: string, contactId: string): string {
  return `${siteOrigin}/api/unsubscribe?c=${contactId}&t=${unsubscribeToken(contactId)}`;
}
