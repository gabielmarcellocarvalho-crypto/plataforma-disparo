"use client";

import { useRef, useState, useTransition } from "react";
import { uploadAgentMedia, deleteAgentMedia } from "@/app/actions/agents";

type AgentMedia = {
  id: string;
  category: string;
  url: string;
  caption: string | null;
  media_type: string;
  file_name: string | null;
};

export function AgentMediaLibrary({ agentId, media }: { agentId: string; media: AgentMedia[] }) {
  const [mediaCategory, setMediaCategory] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaStatus, setMediaStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleUploadMedia() {
    setMediaError(null);
    setMediaStatus(null);
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setMediaError("Selecione os arquivos.");
      return;
    }
    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);
    startTransition(async () => {
      const result = await uploadAgentMedia(agentId, mediaCategory, formData);
      if (result.error) setMediaError(result.error);
      else {
        setMediaStatus(`${result.count} arquivo(s) enviado(s) pra pasta "${mediaCategory}".`);
        setMediaCategory("");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  function handleDeleteMedia(mediaId: string) {
    startTransition(async () => {
      await deleteAgentMedia(mediaId);
    });
  }

  // Agrupa as fotos por pasta (categoria) pra exibir tipo "drive".
  const folders = media.reduce<Record<string, AgentMedia[]>>((acc, m) => {
    (acc[m.category] ||= []).push(m);
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        Fotos e documentos (PDF) organizados em pastas por categoria. Suba vários de uma vez por pasta. O agente vê a
        lista de pastas (e o que você configurou acima sobre quando usar cada uma) e escolhe qual mandar quando o
        cliente pede.
      </p>

      {Object.keys(folders).length > 0 && (
        <div className="flex flex-col gap-2.5">
          {Object.entries(folders).map(([folder, arquivos]) => (
            <div key={folder} className="border border-border rounded-md p-2.5">
              <div className="text-xs font-bold mb-1.5 flex items-center gap-1.5">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden>
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                {folder} <span className="text-text-muted font-semibold">({arquivos.length})</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {arquivos.map((m) => (
                  <div key={m.id} className="relative group">
                    {m.media_type === "document" ? (
                      <a
                        href={m.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={m.file_name || "documento"}
                        className="w-12 h-12 rounded border border-border grid place-items-center bg-bg text-danger"
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                        </svg>
                      </a>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt={folder} className="w-12 h-12 rounded object-cover border border-border" />
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteMedia(m.id)}
                      disabled={pending}
                      aria-label="Remover arquivo"
                      className="absolute -top-1.5 -right-1.5 bg-danger text-white w-4 h-4 rounded-full text-[10px] leading-none grid place-items-center cursor-pointer disabled:opacity-60"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <span className="text-xs font-bold">Subir arquivos numa pasta</span>
        <input
          value={mediaCategory}
          onChange={(e) => setMediaCategory(e.target.value)}
          placeholder="Nome da pasta (ex: produtos, pacotes, cardápio)"
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          multiple
          className="text-xs file:mr-3 file:border-0 file:rounded-md file:bg-primary-soft file:text-primary-strong file:font-semibold file:px-3 file:py-1.5 file:cursor-pointer"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleUploadMedia}
            disabled={pending}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Subir arquivos"}
          </button>
          {mediaStatus && <span className="text-xs font-semibold text-success">{mediaStatus}</span>}
          {mediaError && <span className="text-xs text-danger font-medium">{mediaError}</span>}
        </div>
      </div>
    </div>
  );
}
