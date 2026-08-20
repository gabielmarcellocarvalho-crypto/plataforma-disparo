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

export function buildCampaignEmailHtml(from: string, bodyText: string): string {
  const senderName = escapeHtml(fromDisplayName(from));
  const paragraphs = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 14px;color:#1a1a1a;font-size:15px;line-height:1.6;">${escapeHtml(line)}</p>`)
    .join("");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:24px 28px 8px;border-bottom:1px solid #eee;">
          <span style="font-size:14px;font-weight:700;color:#7C3AED;">${senderName}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">${paragraphs}</td>
      </tr>
      <tr>
        <td style="padding:16px 28px;border-top:1px solid #eee;">
          <p style="margin:0;color:#999;font-size:12px;">Se não quiser mais receber esses e-mails, responda pedindo remoção da lista.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendCampaignEmail(from: string, to: string, subject: string, bodyText: string): Promise<void> {
  if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY não configurada.");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from,
      to,
      subject,
      text: bodyText,
      html: buildCampaignEmailHtml(from, bodyText),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
