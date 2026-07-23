"use client";

import Link from "next/link";
import { useTransition } from "react";
import { refreshAgentStatus, toggleAgentStatus } from "@/app/actions/agents";
import { AgentAvatar } from "@/components/agent-avatar";

type Agent = {
  id: string;
  name: string;
  evolution_instance_name: string;
  phone_number: string | null;
  photo_url: string | null;
  connection_status: string;
  status: "ativo" | "pausado";
};

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
  totalCostUsd,
  canManage,
}: {
  agent: Agent;
  totalCostUsd: number;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const style = CONNECTION_STYLES[agent.connection_status] || DEFAULT_CONNECTION_STYLE;

  function handleToggleStatus() {
    startTransition(async () => {
      await toggleAgentStatus(agent.id, agent.status === "ativo" ? "pausado" : "ativo");
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      await refreshAgentStatus(agent.id);
    });
  }

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <AgentAvatar photoUrl={agent.photo_url} name={agent.name} />
          <div className="min-w-0">
            <div className="font-bold text-[15px] truncate">{agent.name}</div>
            <div className="text-xs text-text-muted truncate">{formatPhone(agent.phone_number) || "sem número conectado"}</div>
          </div>
        </div>

        {canManage ? (
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
        ) : (
          <span
            className={`text-xs font-bold px-3 py-2 rounded-md shrink-0 ${
              agent.status === "ativo" ? "bg-primary-faint text-primary-strong" : "bg-bg text-text-muted"
            }`}
          >
            {agent.status === "ativo" ? "Ativo" : "Pausado"}
          </span>
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
        <div className="flex justify-between text-xs border-t border-border pt-2.5">
          <span className="text-text-muted">Custo estimado</span>
          <span className="font-bold">
            US$ {totalCostUsd.toFixed(4)} (~R$ {(totalCostUsd * USD_TO_BRL).toFixed(2)})
          </span>
        </div>
      )}

      <Link
        href={`/agentes/${agent.id}`}
        className="mt-auto bg-primary-faint text-primary-strong text-sm font-bold px-4 py-2.5 rounded-md text-center cursor-pointer hover:bg-primary-soft transition-colors"
      >
        Editar agente →
      </Link>
    </div>
  );
}
