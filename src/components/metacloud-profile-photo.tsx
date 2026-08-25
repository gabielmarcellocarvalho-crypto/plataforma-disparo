"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { updateInstanceProfilePhoto, getInstanceProfilePhoto } from "@/app/actions/whatsapp";

// Troca a foto de perfil do WhatsApp Business direto pela Graph API (canal metacloud) — mostra a foto
// atual (buscada direto da Meta, não guardamos cópia própria) e permite subir uma nova.
export function MetacloudProfilePhoto({ instanceId }: { instanceId: string }) {
  const [currentUrl, setCurrentUrl] = useState<string | null | undefined>(undefined); // undefined = ainda carregando
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getInstanceProfilePhoto(instanceId).then((r) => setCurrentUrl(r.photoUrl ?? null));
  }, [instanceId]);

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null;
    setFile(f);
    setError(null);
    setSaved(false);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  function handleSave() {
    if (!file) return;
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("photo", file);
      const result = await updateInstanceProfilePhoto(instanceId, fd);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSaved(true);
      setFile(null);
      setPreview(null);
      if (inputRef.current) inputRef.current.value = "";
      if (result.photoUrl !== undefined) setCurrentUrl(result.photoUrl ?? null);
    });
  }

  const displayUrl = preview || currentUrl;

  return (
    <div className="flex items-center gap-3 border-t border-border pt-3 mt-3">
      {displayUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={displayUrl} alt="Foto de perfil do WhatsApp" className="w-12 h-12 rounded-full object-cover border border-border shrink-0" />
      ) : (
        <div className="w-12 h-12 rounded-full bg-bg border border-border shrink-0" />
      )}
      <div className="flex flex-col gap-1.5 min-w-0">
        <span className="text-xs font-bold text-text-muted">Foto de perfil no WhatsApp</span>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={inputRef} type="file" accept="image/jpeg,image/png" onChange={handlePick} className="text-xs w-48" />
          {file && (
            <button
              type="button"
              onClick={handleSave}
              disabled={pending}
              className="text-xs font-bold px-3 py-1.5 rounded-md bg-primary-strong text-white cursor-pointer disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Aplicar no WhatsApp"}
            </button>
          )}
          {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
        </div>
        {error && <p className="text-xs text-danger font-medium">{error}</p>}
        <p className="text-[11px] text-text-muted">JPG ou PNG, até 5MB. A troca é imediata no WhatsApp do cliente.</p>
      </div>
    </div>
  );
}
