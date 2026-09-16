"use client";

import { useEffect, useState } from "react";
import { buildCampaignEmailHtml } from "@/lib/email-template";

// Preview do e-mail na própria tela de criação da campanha. Usa o MESMO gerador de HTML do envio
// (email-template.ts), então o que aparece aqui é literalmente o que sai no Resend — não é uma
// maquete parecida que envelhece sozinha quando o template muda.
export function EmailPreview({
  from,
  subject,
  preheader,
  bodyText,
  ctaLabel,
  ctaUrl,
  brandColor,
  logoUrl,
  bannerFile,
  showBrandHeader = true,
}: {
  from: string | null;
  subject: string;
  preheader: string;
  bodyText: string;
  ctaLabel: string;
  ctaUrl: string;
  brandColor: string | null;
  logoUrl: string | null;
  bannerFile: File | null;
  showBrandHeader?: boolean;
}) {
  // O banner ainda não subiu pro storage enquanto a pessoa escreve, então o preview mostra o arquivo
  // local. Tem que ser data: URL, e NÃO URL.createObjectURL: o iframe abaixo roda em sandbox (origem
  // opaca) e um blob: pertence à origem da PÁGINA — o iframe não consegue carregar e o banner
  // simplesmente não aparecia. data: é autocontido e atravessa o sandbox.
  // Guarda o par arquivo+conteúdo: comparar o arquivo na hora de renderizar evita mostrar o banner
  // ANTERIOR por um quadro quando a pessoa troca a imagem, e dispensa limpar o estado dentro do
  // efeito (setState síncrono em efeito encadeia render à toa).
  const [banner, setBanner] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!bannerFile) return;
    let cancelado = false;
    const reader = new FileReader();
    reader.onload = () => {
      if (!cancelado && typeof reader.result === "string") setBanner({ file: bannerFile, url: reader.result });
    };
    reader.readAsDataURL(bannerFile);
    return () => {
      cancelado = true;
    };
  }, [bannerFile]);
  const bannerDataUrl = bannerFile && banner?.file === bannerFile ? banner.url : null;

  const html = buildCampaignEmailHtml({
    from: from || "Sua empresa <contato@seudominio.com.br>",
    bodyText: bodyText.trim() || "Escreva o corpo do e-mail pra ver o preview aqui.",
    preheader,
    unsubscribeUrl: "#",
    cta: ctaLabel.trim() && ctaUrl.trim() ? { label: ctaLabel.trim(), url: ctaUrl.trim() } : null,
    brandColor,
    logoUrl,
    bannerUrl: bannerDataUrl,
    showBrandHeader,
  });

  // <base target="_blank"> + allow-popups: sem isso, clicar no CTA dentro do preview é bloqueado
  // pelo navegador (frame em sandbox não navega a janela de cima) e parece erro do link, quando o
  // link está certo. Testar o CTA antes de disparar é metade da utilidade do preview.
  const htmlNavegavel = html.replace("<html>", '<html><head><base target="_blank"></head>');

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">Preview</span>
        {!from && <span className="text-[11px] text-warning-text">Remetente não configurado em Configurações</span>}
      </div>
      <div className="border border-border rounded-md overflow-hidden bg-bg">
        <div className="px-3 py-2 border-b border-border bg-surface">
          <p className="text-[11px] text-text-muted">Assunto</p>
          <p className="text-xs font-semibold truncate">
            {subject.trim() || "(sem assunto)"}
            {preheader.trim() && <span className="font-normal text-text-muted"> — {preheader.trim()}</span>}
          </p>
        </div>
        <iframe
          title="Preview do e-mail"
          srcDoc={htmlNavegavel}
          sandbox="allow-popups allow-popups-to-escape-sandbox"
          className="w-full h-80 bg-white block"
        />
      </div>
    </div>
  );
}
