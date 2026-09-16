// Montagem do HTML do e-mail de campanha. Módulo puro de propósito: sem env, sem fetch, sem import
// de servidor — é o que permite a tela de criação de campanha importar o MESMO gerador pro preview
// ao vivo (src/components/email-preview.tsx). Se um dia isso virar servidor-só, o preview passa a
// mentir sobre o que o contato recebe, que é exatamente o problema que ele existe pra resolver.

export type EmailCta = { label: string; url: string };

export type CampaignEmailContent = {
  from: string;
  bodyText: string;
  // Linha que Gmail/Outlook mostram em cinza ao lado do assunto na lista de e-mails. Sem ela o
  // cliente puxa a primeira linha do corpo — nos templates reais, "Olá, Fulano,".
  preheader?: string | null;
  unsubscribeUrl: string;
  cta?: EmailCta | null;
  brandColor?: string | null;
  logoUrl?: string | null;
  bannerUrl?: string | null;
  // false = e-mail sem a faixa de cabeçalho (logo/nome do remetente). Com banner próprio, essa faixa
  // normalmente sobra; e workspace sem logo ganhava uma barra com o nome do remetente que ninguém pediu.
  showBrandHeader?: boolean;
};

// Cor de marca padrão (roxo da própria plataforma) — usada quando o workspace do cliente não tem
// uma cor própria configurada (workspaces.brand_color).
const DEFAULT_BRAND_COLOR = "#7C3AED";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Só http/https entram em href/src. Sem isso, um corpo de campanha com `[clique](javascript:...)`
// viraria link executável na caixa de quem recebe — e o corpo é texto que o cliente digita.
export function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

// Banner e logo não são texto digitado pelo cliente: são URL que a própria plataforma gerou (arquivo
// público no storage) ou, no preview da tela de criação, o blob:/data: do arquivo que a pessoa acabou
// de escolher e ainda nem subiu. Por isso aceitam esses dois esquemas a mais que safeUrl — que segue
// estrito pro que vem do corpo escrito à mão.
export function safeImageSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (/^(blob:|data:image\/)/i.test(trimmed)) return escapeHtml(trimmed);
  return safeUrl(trimmed);
}

// "Nome <email@dominio.com>" → só o nome, pro cabeçalho do e-mail.
function fromDisplayName(from: string): string {
  const match = from.match(/^([^<]+)</);
  return (match ? match[1] : from).trim();
}

// Formatação inline, aplicada DEPOIS do escape — as regexes casam sobre texto já escapado, então
// nada que o cliente digitar vira tag por conta própria.
function inlineFormat(escaped: string, color: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong style="font-weight:700;">$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, rawUrl: string) => {
      const href = safeUrl(rawUrl);
      return href ? `<a href="${href}" style="color:${color};text-decoration:underline;">${label}</a>` : label;
    });
}

// Subconjunto de Markdown que cobre o que uma campanha precisa sem virar editor de texto rico:
//   ## Título          → subtítulo em destaque
//   - item / * item    → lista com marcador
//   ![alt](url)        → imagem no meio do corpo
//   **negrito**        → negrito
//   [texto](url)       → link
// Linha em branco separa blocos. Qualquer outra linha é parágrafo, que é o comportamento antigo —
// campanha escrita antes disso continua saindo igual.
export function renderEmailBody(bodyText: string, color: string): string {
  const lines = bodyText.split("\n");
  const blocks: string[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length === 0) return;
    blocks.push(
      `<ul style="margin:0 0 14px;padding-left:20px;color:#1a1a1a;font-size:15px;line-height:1.6;">${listItems
        .map((item) => `<li style="margin:0 0 6px;">${item}</li>`)
        .join("")}</ul>`
    );
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      continue;
    }

    const image = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      flushList();
      const src = safeUrl(image[2]);
      if (src) {
        blocks.push(
          `<img src="${src}" alt="${escapeHtml(image[1])}" style="display:block;width:100%;max-width:464px;height:auto;border-radius:8px;margin:0 0 16px;">`
        );
      }
      continue;
    }

    if (line.startsWith("## ")) {
      flushList();
      blocks.push(
        `<h2 style="margin:0 0 12px;color:#1a1a1a;font-size:19px;line-height:1.3;font-weight:800;">${inlineFormat(
          escapeHtml(line.slice(3).trim()),
          color
        )}</h2>`
      );
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      listItems.push(inlineFormat(escapeHtml(line.replace(/^[-*]\s+/, "")), color));
      continue;
    }

    flushList();
    blocks.push(
      `<p style="margin:0 0 14px;color:#1a1a1a;font-size:15px;line-height:1.6;">${inlineFormat(escapeHtml(line), color)}</p>`
    );
  }

  flushList();
  return blocks.join("");
}

export function buildCampaignEmailHtml(content: CampaignEmailContent): string {
  const { from, bodyText, preheader, unsubscribeUrl, cta, brandColor, logoUrl, bannerUrl, showBrandHeader = true } = content;
  const color = brandColor || DEFAULT_BRAND_COLOR;
  const senderName = escapeHtml(fromDisplayName(from));
  const body = renderEmailBody(bodyText, color);

  const banner = safeImageSrc(bannerUrl);
  // Banner ocupa a largura toda, acima do cabeçalho — quando existe, ele É o topo do e-mail, então a
  // faixa com logo/nome vira só uma linha de assinatura abaixo, sem a borda colorida competindo.
  const bannerBlock = banner
    ? `<tr><td style="padding:0;"><img src="${banner}" alt="" style="display:block;width:100%;max-width:520px;height:auto;"></td></tr>`
    : "";

  const logo = safeImageSrc(logoUrl);
  const headerContent = logo
    ? `<img src="${logo}" alt="${senderName}" height="32" style="height:32px;width:auto;display:block;">`
    : `<span style="font-size:15px;font-weight:700;color:${color};">${senderName}</span>`;
  const headerBlock = showBrandHeader
    ? `<tr>
        <td style="padding:20px 28px;${banner ? "border-bottom:1px solid #eee;" : `border-bottom:2px solid ${color};`}">
          ${headerContent}
        </td>
      </tr>`
    : "";

  const ctaUrl = cta ? safeUrl(cta.url) : null;
  const ctaBlock =
    cta && ctaUrl
      ? `<tr><td style="padding:8px 28px 28px;">
        <a href="${ctaUrl}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:13px 26px;border-radius:8px;">
          ${escapeHtml(cta.label)}
        </a>
      </td></tr>`
      : "";

  // Bloco invisível no topo do body: é o que o cliente de e-mail lê como preview. O padding de
  // caracteres invisíveis (&zwnj;&nbsp;) empurra o resto do corpo pra fora da linha de preview —
  // sem ele, o Gmail emenda o preheader com "Olá, Fulano," logo depois.
  const preheaderBlock = preheader?.trim()
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${escapeHtml(
        preheader.trim()
      )}${"&zwnj;&nbsp;".repeat(60)}</div>`
    : "";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
    ${preheaderBlock}
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
      ${bannerBlock}
      ${headerBlock}
      <tr>
        <td style="padding:${showBrandHeader || banner ? "28px" : "32px"} 28px 4px;">${body}</td>
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

// Versão texto puro do mesmo conteúdo (multipart do e-mail): tira a marcação do corpo e anexa o CTA
// no fim. Cliente de e-mail que não renderiza HTML recebe isso.
export function buildCampaignEmailText(bodyText: string, cta?: EmailCta | null): string {
  const plain = bodyText
    .split("\n")
    .map((line) => line.replace(/^!\[[^\]]*\]\([^)\s]+\)$/, "").replace(/^##\s+/, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)"))
    .join("\n");
  return plain + (cta ? `\n\n${cta.label}: ${cta.url}` : "");
}
