"use client";

import { useRef, useState, useTransition } from "react";
import { uploadWorkspaceLogo } from "@/app/actions/workspace";

export function WorkspaceLogoEditor({
  workspaceId,
  currentLogoUrl,
  currentBrandColor,
}: {
  workspaceId: string;
  currentLogoUrl: string | null;
  currentBrandColor: string | null;
}) {
  const [logoUrl, setLogoUrl] = useState(currentLogoUrl);
  const [brandColor, setBrandColor] = useState(currentBrandColor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleUpload() {
    setError(null);
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("Selecione um arquivo.");
      return;
    }
    const formData = new FormData();
    formData.append("logo", file);
    startTransition(async () => {
      const result = await uploadWorkspaceLogo(workspaceId, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.logoUrl) setLogoUrl(result.logoUrl);
      if (result.brandColor !== undefined) setBrandColor(result.brandColor ?? null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="Logo" className="w-14 h-14 rounded-md border border-border object-contain bg-white p-1" />
        ) : (
          <div className="w-14 h-14 rounded-md border border-dashed border-border grid place-items-center text-text-muted text-[10px] text-center px-1">
            sem logo
          </div>
        )}
        {brandColor && (
          <div className="flex items-center gap-1.5">
            <span className="w-6 h-6 rounded-full border border-border" style={{ background: brandColor }} aria-hidden />
            <span className="text-xs font-mono text-text-muted">{brandColor}</span>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="text-xs file:mr-3 file:border-0 file:rounded-md file:bg-primary-soft file:text-primary-strong file:font-semibold file:px-3 file:py-1.5 file:cursor-pointer"
      />
      <p className="text-xs text-text-muted">
        PNG, JPG, WEBP ou SVG, até 2MB. A cor de marca dos e-mails é extraída automaticamente da logo (não é
        preciso escolher a cor na mão) — pra trocar a cor, troque a logo.
      </p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleUpload}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
        >
          {pending ? "Enviando…" : "Subir logo"}
        </button>
      </div>
      {error && <p className="text-sm text-danger font-medium">{error}</p>}
    </div>
  );
}
