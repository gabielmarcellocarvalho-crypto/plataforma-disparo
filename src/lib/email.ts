// Envio de e-mail de campanha via Resend. O HTML em si é montado em email-template.ts (módulo puro,
// compartilhado com o preview da tela de criação) — aqui fica só o transporte.
import { buildCampaignEmailHtml, buildCampaignEmailText, type EmailCta } from "@/lib/email-template";

const RESEND_API_KEY = process.env.RESEND_API_KEY;

export { buildCampaignEmailHtml };
export type { EmailCta };

// RESEND_API_KEY é 1 chave só, compartilhada por TODOS os workspaces — a cota diária/mensal do plano
// Resend também é compartilhada. Um 429 aqui não é "esse e-mail falhou", é "a conta inteira bateu no
// teto agora" — quem chama precisa tratar isso como temporário (tentar de novo mais tarde), nunca como
// falha permanente desse destinatário específico.
export class ResendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type SendCampaignEmailInput = {
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  preheader?: string | null;
  unsubscribeUrl: string;
  cta?: EmailCta | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
};

// Objeto em vez de argumento posicional: eram 8 parâmetros na fila, e o CTA no meio já tinha sido
// passado errado uma vez (o disparo em massa mandava `undefined` ali e ninguém percebia).
export async function sendCampaignEmail(input: SendCampaignEmailInput): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const { from, to, subject, bodyText, preheader, unsubscribeUrl, cta, brandColor, logoUrl, bannerUrl } = input;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: buildCampaignEmailText(bodyText, cta),
      html: buildCampaignEmailHtml({ from, bodyText, preheader, unsubscribeUrl, cta, brandColor, logoUrl, bannerUrl }),
      // List-Unsubscribe (RFC 8058) — Gmail/Outlook/Yahoo mostram um botão nativo de cancelar
      // inscrição usando isso, sem precisar abrir o link no navegador. Exigido pelas políticas de
      // remetente em massa da Gmail/Yahoo desde 2024 — sem isso, risco maior de cair em spam.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) throw new ResendError(res.status, `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
