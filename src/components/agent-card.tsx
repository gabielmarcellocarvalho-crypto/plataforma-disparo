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
  // % das conversas dos últimos 30 dias que não precisaram da equipe (null = sem conversa no período).
  resolutionRate?: number | null;
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
  const resolved = stats.resolutionRate ?? null;

  // Card vertical (estilo do redesign): identidade, 3 números, barras de resolução e ações.
  return (
    <article className={cn("bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4 transition-shadow hover:shadow-md h-full", pending && "opacity-70")}>
      <div className="flex items-start gap-3.5 min-w-0">
        <AgentAvatar photoUrl={agent.photo_url} name={agent.name} size="lg" />
        <div className="min-w-0 flex-1 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Link href={`/agentes/${agent.id}`} className="font-bold text-[17px] leading-tight truncate hover:text-primary-strong transition-colors">
              {agent.name}
            </Link>
            <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full", active ? "bg-success-soft text-success" : "bg-surface-2 border border-border text-text-muted")}>
              {active ? "Ativo" : "Pausado"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-muted">
            <span className={cn("inline-flex items-center gap-1.5 font-semibold", conn.text)}>
              <span className={cn("w-2 h-2 rounded-full", conn.dot)} aria-hidden />
              {conn.label}
            </span>
            <span>·</span>
            <span className="truncate">
              {phone || (isInstanceLinked ? (agent.whatsapp_instance_channel === "360dialog" ? "360dialog" : "API oficial Meta") : "sem número")}
            </span>
            <span>·</span>
            <span>última atividade {stats.conversationsToday === null ? "—" : formatLastActivity(stats.lastActivity)}</span>
          </div>
        </div>
        {canManage && <AgentActionsMenu agent={agent} pending={pending} onToggle={handleToggleStatus} onRefresh={handleRefresh} />}
      </div>

      <div className={cn("grid gap-2.5", canManage ? "grid-cols-3" : "grid-cols-2")}>
        {[
          { icon: <MessageCircle className="w-3.5 h-3.5" />, label: "Conversas hoje", value: fmt(stats.conversationsToday) },
          { icon: <UserRound className="w-3.5 h-3.5" />, label: "Leads atendidos", value: fmt(stats.leadsTotal) },
          ...(canManage
            ? [{ icon: <Wallet className="w-3.5 h-3.5" />, label: "Custo estimado", value: `R$ ${(totalCostUsd * USD_TO_BRL).toFixed(2).replace(".", ",")}` }]
            : []),
        ].map((m) => (
          <div key={m.label} className="rounded-md border border-border px-3 py-2.5">
            <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
              {m.icon}
              {m.label}
            </span>
            <b className="block text-xl font-extrabold tracking-tight tabular-nums mt-0.5">{m.value}</b>
          </div>
        ))}
      </div>

      <div className="rounded-md bg-surface-2 border border-border px-3 py-2.5 flex flex-col gap-2" title="Últimos 30 dias">
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Resolvidas sem humano</span>
            <b className="tabular-nums">{resolved === null ? "—" : `${resolved}%`}</b>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-success rounded-full" style={{ width: `${resolved ?? 0}%` }} />
          </div>
        </div>
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-text-muted">Passadas para humano</span>
            <b className="tabular-nums">{resolved === null ? "—" : `${100 - resolved}%`}</b>
          </div>
          <div className="h-1.5 rounded-full bg-border overflow-hidden">
            <div className="h-full bg-danger rounded-full" style={{ width: `${resolved === null ? 0 : 100 - resolved}%` }} />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-auto">
        <Link
          href={`/agentes/${agent.id}`}
          className="inline-flex items-center gap-1.5 min-h-9 px-3.5 rounded-md bg-primary-strong text-white text-sm font-bold hover:brightness-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Editar agente
          <ArrowRight className="w-4 h-4" aria-hidden />
        </Link>
        <Link href="/conversas" className="ml-auto text-xs font-bold text-text-muted hover:text-text">
          Ver conversas
        </Link>
      </div>
    </article>
  );
}
