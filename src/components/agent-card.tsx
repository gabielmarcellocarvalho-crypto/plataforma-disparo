"use client";

import { useRef, useState, useTransition } from "react";
import {
  connectAgent,
  refreshAgentStatus,
  updateAgentPrompt,
  toggleAgentStatus,
  updateAgentDelay,
  uploadAgentMedia,
  deleteAgentMedia,
} from "@/app/actions/agents";

type Agent = {
  id: string;
  name: string;
  system_prompt: string;
  evolution_instance_name: string;
  phone_number: string | null;
  photo_url: string | null;
  connection_status: string;
  status: "ativo" | "pausado";
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
};

type AgentMedia = { id: string; category: string; url: string; caption: string | null };

const USD_TO_BRL = 5.4; // referência aproximada — mesma taxa usada na calculadora de custos

const CONNECTION_STYLES: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  open: { label: "Conectado", bg: "bg-success-soft", text: "text-success", dot: "bg-success" },
  connecting: { label: "Conectando…", bg: "bg-warning-soft", text: "text-warning-text", dot: "bg-warning-text" },
  conectando: { label: "Conectando…", bg: "bg-warning-soft", text: "text-warning-text", dot: "bg-warning-text" },
};
const DEFAULT_CONNECTION_STYLE = { label: "Desconectado", bg: "bg-bg", text: "text-text-muted", dot: "bg-text-muted" };

function formatPhone(phone: string | null) {
  if (!phone) return null;
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${phone}`;
}

export function AgentCard({
  agent,
  model,
  totalCostUsd,
  media,
}: {
  agent: Agent;
  model: string;
  totalCostUsd: number;
  media: AgentMedia[];
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState(agent.system_prompt);
  const [promptSaved, setPromptSaved] = useState(false);
  const [delayMin, setDelayMin] = useState(agent.reply_delay_min_seconds);
  const [delayMax, setDelayMax] = useState(agent.reply_delay_max_seconds);
  const [delaySaved, setDelaySaved] = useState(false);
  const [delayError, setDelayError] = useState<string | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaCategory, setMediaCategory] = useState("");
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaStatus, setMediaStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const connected = agent.connection_status === "open";
  const style = CONNECTION_STYLES[agent.connection_status] || DEFAULT_CONNECTION_STYLE;

  function handleConnect() {
    setError(null);
    startTransition(async () => {
      const result = await connectAgent(agent.id);
      if (result.error) setError(result.error);
      else setQr(result.qrcodeBase64 ?? null);
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      await refreshAgentStatus(agent.id);
    });
  }

  function handleSavePrompt() {
    setPromptSaved(false);
    startTransition(async () => {
      const result = await updateAgentPrompt(agent.id, prompt);
      if (!result.error) setPromptSaved(true);
    });
  }

  function handleToggleStatus() {
    startTransition(async () => {
      await toggleAgentStatus(agent.id, agent.status === "ativo" ? "pausado" : "ativo");
    });
  }

  function handleSaveDelay() {
    setDelaySaved(false);
    setDelayError(null);
    startTransition(async () => {
      const result = await updateAgentDelay(agent.id, delayMin, delayMax);
      if (result.error) setDelayError(result.error);
      else setDelaySaved(true);
    });
  }

  function handleUploadMedia() {
    setMediaError(null);
    setMediaStatus(null);
    const files = fileInputRef.current?.files;
    if (!files || files.length === 0) {
      setMediaError("Selecione as fotos.");
      return;
    }
    const formData = new FormData();
    for (const file of Array.from(files)) formData.append("files", file);
    startTransition(async () => {
      const result = await uploadAgentMedia(agent.id, mediaCategory, formData);
      if (result.error) setMediaError(result.error);
      else {
        setMediaStatus(`${result.count} foto(s) enviada(s) pra pasta "${mediaCategory}".`);
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
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {agent.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={agent.photo_url}
              alt={`Foto de perfil do agente ${agent.name}`}
              className="w-10 h-10 rounded-lg object-cover shrink-0 border border-border"
            />
          ) : (
            <span className="grid place-items-center w-10 h-10 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="10" rx="2" />
                <circle cx="12" cy="5" r="2" />
                <path d="M12 7v4" />
                <line x1="8" y1="16" x2="8" y2="16" />
                <line x1="16" y1="16" x2="16" y2="16" />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <div className="font-bold text-[15px] truncate">{agent.name}</div>
            <div className="text-xs text-text-muted truncate">{formatPhone(agent.phone_number) || "sem número conectado"}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleStatus}
          disabled={pending}
          className={`text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
            agent.status === "ativo" ? "bg-primary-faint text-primary-strong" : "bg-bg text-text-muted"
          }`}
          aria-label={agent.status === "ativo" ? "Pausar agente" : "Reativar agente"}
        >
          {agent.status === "ativo" ? "Ativo" : "Pausado"}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <span className={`flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 rounded-full ${style.bg} ${style.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} aria-hidden />
          {style.label}
        </span>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={pending}
          className="text-xs font-semibold text-primary-strong hover:underline disabled:opacity-60 cursor-pointer"
        >
          Atualizar status
        </button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-b border-border py-2.5">
        <div className="flex justify-between">
          <span className="text-text-muted">Modelo</span>
          <span className="font-semibold">{model}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-muted">Instância</span>
          <span className="font-semibold font-mono">{agent.evolution_instance_name}</span>
        </div>
        <div className="flex justify-between col-span-2">
          <span className="text-text-muted">Custo estimado (todas as conversas)</span>
          <span className="font-bold">
            US$ {totalCostUsd.toFixed(4)} (~R$ {(totalCostUsd * USD_TO_BRL).toFixed(2)})
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-bold">Delay antes de responder (segundos)</span>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0}
            value={delayMin}
            onChange={(e) => {
              setDelayMin(Number(e.target.value));
              setDelaySaved(false);
            }}
            className="w-20 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          <span className="text-text-muted">a</span>
          <input
            type="number"
            min={0}
            value={delayMax}
            onChange={(e) => {
              setDelayMax(Number(e.target.value));
              setDelaySaved(false);
            }}
            className="w-20 border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={handleSaveDelay}
            disabled={pending}
            className="border border-border text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
          >
            Salvar
          </button>
          {delaySaved && <span className="text-xs font-semibold text-success">Salvo.</span>}
        </div>
        {delayError && <p className="text-xs text-danger font-medium">{delayError}</p>}
        <p className="text-xs text-text-muted">Espera aleatória nesse intervalo antes de mandar a resposta — evita parecer um bot instantâneo.</p>
      </div>

      {!connected && (
        <div className="flex flex-col items-start gap-2">
          <button
            type="button"
            onClick={handleConnect}
            disabled={pending}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Gerando QR…" : "Conectar número"}
          </button>
          {error && <p className="text-sm text-danger font-medium">{error}</p>}
          {qr && (
            <div className="flex flex-col items-start gap-2">
              <p className="text-sm text-text-muted">Escaneie com o WhatsApp que vai virar esse agente (Aparelhos conectados → Conectar um aparelho):</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt={`QR code de conexão do agente ${agent.name}`} className="w-56 h-56 border border-border rounded-lg" />
              <p className="text-xs text-text-muted">Depois de escanear, clique em &quot;Atualizar status&quot;.</p>
            </div>
          )}
        </div>
      )}

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setPromptOpen((v) => !v)}
          className="flex items-center justify-between w-full text-left cursor-pointer py-1"
          aria-expanded={promptOpen}
        >
          <span className="text-sm font-bold">Prompt do agente</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-text-muted transition-transform ${promptOpen ? "rotate-180" : ""}`}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {promptOpen && (
          <div className="flex flex-col gap-2 mt-2">
            <textarea
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                setPromptSaved(false);
              }}
              rows={8}
              placeholder="Instruções de como esse agente deve conduzir a conversa (tom, o que oferecer, quando escalar pra um humano)…"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary resize-y font-mono"
            />
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleSavePrompt}
                disabled={pending}
                className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Salvar prompt
              </button>
              {promptSaved && <span className="text-xs font-semibold text-success">Salvo.</span>}
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setMediaOpen((v) => !v)}
          className="flex items-center justify-between w-full text-left cursor-pointer py-1"
          aria-expanded={mediaOpen}
        >
          <span className="text-sm font-bold">Fotos do agente ({media.length})</span>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-text-muted transition-transform ${mediaOpen ? "rotate-180" : ""}`}
            aria-hidden
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {mediaOpen && (
          <div className="flex flex-col gap-3 mt-2">
            <p className="text-xs text-text-muted">
              Fotos organizadas em pastas (quartos, lazer, etc.). Suba várias de uma vez por pasta. O agente vê a
              lista de pastas e escolhe qual mandar quando o cliente pede.
            </p>

            {Object.keys(folders).length > 0 && (
              <div className="flex flex-col gap-2.5">
                {Object.entries(folders).map(([folder, fotos]) => (
                  <div key={folder} className="border border-border rounded-md p-2.5">
                    <div className="text-xs font-bold mb-1.5 flex items-center gap-1.5">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-muted" aria-hidden>
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                      </svg>
                      {folder} <span className="text-text-muted font-semibold">({fotos.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {fotos.map((m) => (
                        <div key={m.id} className="relative group">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={m.url} alt={folder} className="w-12 h-12 rounded object-cover border border-border" />
                          <button
                            type="button"
                            onClick={() => handleDeleteMedia(m.id)}
                            disabled={pending}
                            aria-label="Remover foto"
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
              <span className="text-xs font-bold">Subir fotos numa pasta</span>
              <input
                value={mediaCategory}
                onChange={(e) => setMediaCategory(e.target.value)}
                placeholder="Nome da pasta (ex: quarto standard, piscina, café da manhã)"
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
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
                  {pending ? "Enviando…" : "Subir fotos"}
                </button>
                {mediaStatus && <span className="text-xs font-semibold text-success">{mediaStatus}</span>}
                {mediaError && <span className="text-xs text-danger font-medium">{mediaError}</span>}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
