"use client";

import { useState, useTransition } from "react";
import { connectAgent, refreshAgentStatus, toggleAgentStatus, updateAgentDelay } from "@/app/actions/agents";
import { AgentAvatar } from "@/components/agent-avatar";
import { AgentConfigForm } from "@/components/agent-config-form";
import { AgentMediaLibrary } from "@/components/agent-media-library";
import { AgentKnowledgeLibrary } from "@/components/agent-knowledge-library";
import { normalizeAgentConfig } from "@/lib/agent-prompt";

type Agent = {
  id: string;
  name: string;
  system_prompt: string;
  config: unknown;
  evolution_instance_name: string;
  phone_number: string | null;
  photo_url: string | null;
  connection_status: string;
  status: "ativo" | "pausado";
  reply_delay_min_seconds: number;
  reply_delay_max_seconds: number;
};

type AgentMedia = {
  id: string;
  category: string;
  url: string;
  caption: string | null;
  media_type: string;
  file_name: string | null;
};

type KnowledgeDoc = { id: string; file_name: string; char_count: number };

const USD_TO_BRL = 5.4;

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

export function AgentEditView({
  agent,
  model,
  totalCostUsd,
  media,
  knowledge,
  canManage,
}: {
  agent: Agent;
  model: string;
  totalCostUsd: number;
  media: AgentMedia[];
  knowledge: KnowledgeDoc[];
  canManage: boolean;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [delayMin, setDelayMin] = useState(agent.reply_delay_min_seconds);
  const [delayMax, setDelayMax] = useState(agent.reply_delay_max_seconds);
  const [delaySaved, setDelaySaved] = useState(false);
  const [delayError, setDelayError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const connected = agent.connection_status === "open";
  const style = CONNECTION_STYLES[agent.connection_status] || DEFAULT_CONNECTION_STYLE;
  const mediaCategories = [...new Set(media.map((m) => m.category))];

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

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-surface border border-border rounded-2xl shadow-sm p-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <AgentAvatar photoUrl={agent.photo_url} name={agent.name} size="lg" />
            <div className="min-w-0">
              <h1 className="text-xl font-extrabold tracking-tight truncate">{agent.name}</h1>
              <p className="text-sm text-text-muted truncate">{formatPhone(agent.phone_number) || "sem número conectado"}</p>
            </div>
          </div>

          {canManage && (
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
          )}
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

        {canManage && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-border pt-3">
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
        )}

        {canManage && !connected && (
          <div className="flex flex-col items-start gap-2 border-t border-border pt-3">
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
      </div>

      {canManage && (
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold mb-3">Delay antes de responder (segundos)</h2>
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
          {delayError && <p className="text-xs text-danger font-medium mt-1.5">{delayError}</p>}
          <p className="text-xs text-text-muted mt-1.5">Espera aleatória nesse intervalo antes de mandar a resposta — evita parecer um bot instantâneo.</p>
        </div>
      )}

      {canManage && (
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold mb-4">Configuração do agente</h2>
          <AgentConfigForm
            agentId={agent.id}
            initialConfig={normalizeAgentConfig(agent.config)}
            initialSystemPrompt={agent.system_prompt}
            mediaCategories={mediaCategories}
          />
        </div>
      )}

      {canManage && (
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold mb-3">Arquivos que o agente manda pro cliente ({media.length})</h2>
          <AgentMediaLibrary agentId={agent.id} media={media} />
        </div>
      )}

      {canManage && (
        <div className="bg-surface border border-border rounded-2xl shadow-sm p-6">
          <h2 className="text-sm font-bold mb-3">Material de estudo do agente ({knowledge.length})</h2>
          <AgentKnowledgeLibrary agentId={agent.id} docs={knowledge} />
        </div>
      )}
    </div>
  );
}
