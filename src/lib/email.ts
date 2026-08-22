// Envio de e-mail de campanha via Resend — layout HTML básico (antes era texto puro, sem
// formatação nenhuma). Um passo inicial: header com o nome do remetente, corpo com as quebras de
// linha do texto da campanha, rodapé simples. Personalização de marca (logo, cor) fica pra quando
// tiver pedido real de cliente por isso.
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// "Nome <email@dominio.com>" → só o nome, pro cabeçalho do e-mail.
function fromDisplayName(from: string): string {
  const match = from.match(/^([^<]+)</);
  return (match ? match[1] : from).trim();
}

export type EmailCta = { label: string; url: string };

// Cor de marca padrão (roxo da própria plataforma) — usada quando o workspace do cliente não tem
// uma cor própria configurada (workspaces.brand_color).
const DEFAULT_BRAND_COLOR = "#7C3AED";

export function buildCampaignEmailHtml(
  from: string,
  bodyText: string,
  unsubscribeUrl: string,
  cta?: EmailCta,
  brandColor?: string | null,
  logoUrl?: string | null
): string {
  const color = brandColor || DEFAULT_BRAND_COLOR;
  const senderName = escapeHtml(fromDisplayName(from));
  const paragraphs = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 14px;color:#1a1a1a;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("");

  const ctaBlock = cta
    ? `<tr><td style="padding:8px 28px 28px;">
        <a href="${cta.url}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;">
          ${escapeHtml(cta.label)}
        </a>
      </td></tr>`
    : "";

  const headerContent = logoUrl
    ? `<img src="${logoUrl}" alt="${senderName}" height="32" style="height:32px;width:auto;display:block;">`
    : `<span style="font-size:15px;font-weight:700;color:${color};">${senderName}</span>`;

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:20px 28px;border-bottom:2px solid ${color};">
          ${headerContent}
        </td>
      </tr>
      <tr>
        <td style="padding:28px 28px 4px;">${paragraphs}</td>
      </tr>
      ${ctaBlock}
      <tr>
        <td style="padding:18px 28px;border-top:1px solid #eee;">
          <p style="margin:0;color:#999;font-size:12px;line-height:1.5;">
            Se não quiser mais receber esses e-mails, <a href="${unsubscribeUrl}" style="color:${color};">clique aqui pra sair da lista</a>.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendCampaignEmail(
  from: string,
  to: string,
  subject: string,
  bodyText: string,
  unsubscribeUrl: string,
  cta?: EmailCta,
  brandColor?: string | null,
  logoUrl?: string | null
): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: bodyText + (cta ? `\n\n${cta.label}: ${cta.url}` : ""),
      html: buildCampaignEmailHtml(from, bodyText, unsubscribeUrl, cta, brandColor, logoUrl),
      // List-Unsubscribe (RFC 8058) — Gmail/Outlook/Yahoo mostram um botão nativo de cancelar
      // inscrição usando isso, sem precisar abrir o link no navegador. Exigido pelas políticas de
      // remetente em massa da Gmail/Yahoo desde 2024 — sem isso, risco maior de cair em spam.
      headers: {
        "List-Unsubscribe": `<${unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
