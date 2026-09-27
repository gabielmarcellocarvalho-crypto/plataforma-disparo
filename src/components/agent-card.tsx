"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowRight, MessageCircle, MoreHorizontal, Pause, Play, RefreshCw, UserRound, Wallet, MessagesSquare } from "lucide-react";
import { refreshAgentStatus, toggleAgentStatus } from "@/app/actions/agents";
import { AgentAvatar } from "@/components/agent-avatar";
import { cn } from "@/lib/utils";

export type AgentCardData = {
  id: string;
  name: string;
  evolution_instance_name: string | null;
  whatsapp_instance_channel: "360dialog" | "metacloud" | null;
  phone_number: string | null;
  photo_url: string | null;
  connection_status: string;
  status: "ativo" | "pausado";
};

// null = métrica indisponível (função agent_list_stats ainda não criada) — mostra "—", nunca zero falso.
export type AgentCardStats = {
  conversationsToday: number | null;
  leadsTotal: number | null;
  lastActivity: string | null;
};

const USD_TO_BRL = 5.4; // referência aproximada — mesma taxa usada na calculadora de custos
const TZ = "America/Sao_Paulo";

// Estado da conexão como a equipe entende. Número oficial (360dialog/Meta) vinculado conta como
// conectado — ele não passa pelo connection_status da Evolution.
export type ConnectionState = "conectado" | "conectando" | "desconectado";

export function connectionStateOf(agent: AgentCardData): ConnectionState {
  if (agent.whatsapp_instance_channel) return "conectado";
  if (agent.connection_status === "open") return "conectado";
  if (agent.connection_status === "connecting" || agent.connection_status === "conectando") return "conectando";
  return "desconectado";
}

const CONNECTION_UI: Record<ConnectionState, { label: string; dot: string; text: string }> = {
  conectado: { label: "WhatsApp conectado", dot: "bg-success", text: "text-success" },
  conectando: { label: "Conectando…", dot: "bg-warning-text", text: "text-warning-text" },
  desconectado: { label: "Desconectado", dot: "bg-text-muted", text: "text-text-muted" },
};

function formatPhone(phone: string | null) {
  if (!phone) return null;
  const m = phone.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${phone}`;
}

function dayKey(d: Date) {
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function formatLastActivity(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const today = dayKey(new Date());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000));
  if (dayKey(d) === today) return `hoje, ${time}`;
  if (dayKey(d) === yesterday) return `ontem, ${time}`;
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ })}, ${time}`;
}

function Metric({ icon, label, value, title }: { icon: React.ReactNode; label: string; value: string; title?: string }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0" title={title}>
      <span className="grid place-items-center w-8 h-8 rounded-lg bg-surface-2 text-text-muted shrink-0" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted leading-tight whitespace-nowrap">{label}</div>
        <div className="text-base font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

// Menu de três pontos com as ações que antes ficavam soltas no card (pausar/reativar, atualizar status).
function AgentActionsMenu({
  agent,
  pending,
  onToggle,
  onRefresh,
}: {
  agent: AgentCardData;
  pending: boolean;
  onToggle: () => void;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const item =
    "w-full flex items-center gap-2 px-3 py-2 text-sm text-left rounded-md cursor-pointer hover:bg-surface-2 disabled:opacity-60 disabled:cursor-not-allowed";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mais ações de ${agent.name}`}
        className="grid place-items-center w-9 h-9 rounded-lg text-text-muted hover:text-text hover:bg-surface-2 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <MoreHorizontal className="w-5 h-5" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-20 w-56 bg-surface border border-border rounded-lg shadow-lg p-1">
          <button
            type="button"
            role="menuitem"
            disabled={pending}
            onClick={() => {
              onToggle();
              setOpen(false);
            }}
            className={item}
          >
            {agent.status === "ativo" ? <Pause className="w-4 h-4 text-text-muted" aria-hidden /> : <Play className="w-4 h-4 text-text-muted" aria-hidden />}
            {agent.status === "ativo" ? "Pausar agente" : "Reativar agente"}
          </button>
          {!agent.whatsapp_instance_channel && (
            <button
              type="button"
              role="menuitem"
              disabled={pending}
              onClick={() => {
                onRefresh();
                setOpen(false);
              }}
              className={item}
            >
              <RefreshCw className="w-4 h-4 text-text-muted" aria-hidden />
              Atualizar status da conexão
            </button>
          )}
          <Link href="/conversas" role="menuitem" className={item}>
            <MessagesSquare className="w-4 h-4 text-text-muted" aria-hidden />
            Ver conversas
          </Link>
        </div>
      )}
    </div>
  );
}

export function AgentCard({
  agent,
  stats,
  totalCostUsd,
  canManage,
}: {
  agent: AgentCardData;
  stats: AgentCardStats;
  totalCostUsd: number;
  canManage: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const isInstanceLinked = Boolean(agent.whatsapp_instance_channel);
  const conn = CONNECTION_UI[connectionStateOf(agent)];
  const phone = formatPhone(agent.phone_number);
  const active = agent.status === "ativo";

  function handleToggleStatus() {
    startTransition(async () => {
      await toggleAgentStatus(agent.id, active ? "pausado" : "ativo");
    });
  }

  function handleRefresh() {
    startTransition(async () => {
      await refreshAgentStatus(agent.id);
    });
  }

  const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"));

  return (
    <article
      className={cn(
        "bg-surface border border-border rounded-xl shadow-sm px-5 py-4 grid gap-4 items-center transition-shadow hover:shadow-md",
        "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]",
        pending && "opacity-70"
      )}
    >
      {/* Identidade + conexão */}
      <div className="flex items-center gap-4 min-w-0">
        <AgentAvatar photoUrl={agent.photo_url} name={agent.name} size="lg" />
        <div className="min-w-0 flex flex-col gap-1">
          <Link href={`/agentes/${agent.id}`} className="font-bold text-[17px] leading-tight truncate hover:text-primary-strong transition-colors">
            {agent.name}
          </Link>
          <div className="text-sm text-text-muted truncate">
            {phone || (isInstanceLinked ? "Número conectado em Configurações" : "Sem número conectado")}
            {isInstanceLinked && (
              <span className="ml-1.5 text-[11px] font-semibold text-text-muted">· {agent.whatsapp_instance_channel === "360dialog" ? "360dialog" : "API oficial Meta"}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", conn.text)}>
              <span className={cn("w-2 h-2 rounded-full", conn.dot)} aria-hidden />
              {conn.label}
            </span>
            <span className="w-px h-3 bg-border" aria-hidden />
            <span className="text-text-muted">
              Última atividade: {stats.conversationsToday === null ? "—" : formatLastActivity(stats.lastActivity)}
            </span>
          </div>
        </div>
      </div>

      <span className="hidden lg:block w-px h-12 bg-border" aria-hidden />

      {/* Métricas */}
      <div className="flex flex-wrap gap-x-7 gap-y-3 lg:pr-3">
        <Metric icon={<MessageCircle className="w-4 h-4" />} label="Conversas hoje" value={fmt(stats.conversationsToday)} />
        <Metric icon={<UserRound className="w-4 h-4" />} label="Leads atendidos" value={fmt(stats.leadsTotal)} title="Contatos que já conversaram com esse agente" />
        {canManage && (
          <Metric
            icon={<Wallet className="w-4 h-4" />}
            label="Custo estimado"
            value={`R$ ${(totalCostUsd * USD_TO_BRL).toFixed(2).replace(".", ",")}`}
            title={`US$ ${totalCostUsd.toFixed(4)} em tokens de IA (referência aproximada)`}
          />
        )}
      </div>

      {/* Status + ações */}
      <div className="flex items-center gap-2 lg:justify-end">
        <span
          className={cn(
            "text-xs font-bold px-2.5 py-1 rounded-full",
            active ? "bg-success-soft text-success" : "bg-surface-2 border border-border text-text-muted"
          )}
        >
          {active ? "Ativo" : "Inativo"}
        </span>
        <Link
          href={`/agentes/${agent.id}`}
          className="inline-flex items-center gap-1.5 min-h-9 px-3.5 rounded-lg border border-border bg-surface text-sm font-bold hover:bg-surface-2 hover:border-border-strong transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Editar agente
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
        {canManage && <AgentActionsMenu agent={agent} pending={pending} onToggle={handleToggleStatus} onRefresh={handleRefresh} />}
      </div>
    </article>
  );
}
