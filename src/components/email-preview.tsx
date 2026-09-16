"use client";

import { useEffect, useMemo } from "react";
import { buildCampaignEmailHtml } from "@/lib/email-template";

// Preview do e-mail na própria tela de criação da campanha. Usa o MESMO gerador de HTML do envio
// (email-template.ts), então o que aparece aqui é literalmente o que sai no Resend — não é uma
// maquete parecida que envelhece sozinha quando o template muda.
export function EmailPreview({
  from,
  subject,
  bodyText,
  ctaLabel,
  ctaUrl,
  brandColor,
  logoUrl,
  bannerFile,
}: {
  from: string | null;
  subject: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  brandColor: string | null;
  logoUrl: string | null;
  bannerFile: File | null;
}) {
  // O banner ainda não subiu pro storage enquanto a pessoa escreve — o preview usa a URL local do
  // arquivo escolhido. useMemo (e não estado dentro de efeito) pra não renderizar um quadro com o
  // banner antigo antes de trocar; o efeito só serve pra revogar a URL anterior.
  const bannerPreview = useMemo(() => (bannerFile ? URL.createObjectURL(bannerFile) : null), [bannerFile]);
  useEffect(() => () => {
    if (bannerPreview) URL.revokeObjectURL(bannerPreview);
  }, [bannerPreview]);

  const html = buildCampaignEmailHtml({
    from: from || "Sua empresa <contato@seudominio.com.br>",
    bodyText: bodyText.trim() || "Escreva o corpo do e-mail pra ver o preview aqui.",
    unsubscribeUrl: "#",
    cta: ctaLabel.trim() && ctaUrl.trim() ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : null,
    brandColor,
    logoUrl,
    bannerUrl: bannerPreview,
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">Preview</span>
        {!from && <span className="text-[11px] text-warning-text">Remetente não configurado em Configurações</span>}
      </div>
      <div className="border border-border rounded-md overflow-hidden bg-bg">
        <div className="px-3 py-2 border-b border-border bg-surface">
          <p className="text-[11px] text-text-muted">Assunto</p>
          <p className="text-xs font-semibold truncate">{subject.trim() || "(sem assunto)"}</p>
        </div>
        <iframe
          title="Preview do e-mail"
          srcDoc={html}
          sandbox=""
          className="w-full h-80 bg-white block"
        />
      </div>
    </div>
  );
}
