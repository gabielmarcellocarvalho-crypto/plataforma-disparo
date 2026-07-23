"use client";

import { useRef, useState, useTransition } from "react";
import { uploadAgentKnowledge, deleteAgentKnowledge } from "@/app/actions/agents";
import { MAX_UPLOAD_BYTES } from "@/lib/agent-knowledge-limits";

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

type KnowledgeDoc = { id: string; file_name: string; char_count: number };

export function AgentKnowledgeLibrary({ agentId, docs }: { agentId: string; docs: KnowledgeDoc[] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleUpload() {
    setError(null);
    setStatus(null);
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setError("Selecione pelo menos um arquivo.");
      return;
    }
    const tooBig = Array.from(files).find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" tem ${(tooBig.size / 1024 / 1024).toFixed(1)}MB — limite é ${MAX_UPLOAD_MB}MB por arquivo.`);
      return;
    }
    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);
    startTransition(async () => {
      const result = await uploadAgentKnowledge(agentId, formData);
      if (result.count) {
        setStatus(`${result.count} arquivo(s) processado(s) e adicionado(s) ao material de estudo.`);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      if (result.error) setError(result.error);
    });
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      await deleteAgentKnowledge(id);
    });
  }

  const totalChars = docs.reduce((sum, d) => sum + d.char_count, 0);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        PDF, planilha (xlsx/csv) ou texto que o agente usa como referência pra responder com mais precisão sobre a
        empresa — <strong>nunca é enviado ao cliente</strong>, só vira contexto interno. Fica em cache: só pesa no
        custo de verdade na primeira mensagem depois de um tempo parado. Limite de {MAX_UPLOAD_MB}MB por arquivo
        (só o texto relevante é extraído e guardado, não o arquivo inteiro).
      </p>

      {docs.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center justify-between gap-2 border border-border rounded-md px-3 py-2">
              <div className="min-w-0 flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted shrink-0" aria-hidden>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-xs font-semibold truncate">{d.file_name}</span>
                <span className="text-[11px] text-text-muted shrink-0">{Math.max(1, Math.round(d.char_count / 1000))}k car.</span>
              </div>
              <button type="button" onClick={() => handleDelete(d.id)} disabled={pending} className="text-danger text-xs font-bold px-1.5 cursor-pointer disabled:opacity-60">
                remover
              </button>
            </div>
          ))}
          <p className="text-[11px] text-text-muted">Total: ~{Math.max(1, Math.round(totalChars / 1000))}k caracteres nesse material.</p>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border pt-2.5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,.txt,.md"
          multiple
          className="text-xs file:mr-3 file:border-0 file:rounded-md file:bg-primary-soft file:text-primary-strong file:font-semibold file:px-3 file:py-1.5 file:cursor-pointer"
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleUpload}
            disabled={pending}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
          >
            {pending ? "Processando…" : "Adicionar material"}
          </button>
          {status && <span className="text-xs font-semibold text-success">{status}</span>}
          {error && <span className="text-xs text-danger font-medium">{error}</span>}
        </div>
      </div>
    </div>
  );
}
