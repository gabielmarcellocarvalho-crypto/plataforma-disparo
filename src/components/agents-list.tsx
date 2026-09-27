"use client";

import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { AgentCard, connectionStateOf, type AgentCardData, type AgentCardStats } from "@/components/agent-card";

type StatusFilter = "todos" | "ativos" | "inativos" | "conectados" | "desconectados";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "todos", label: "Todos os status" },
  { key: "ativos", label: "Ativos" },
  { key: "inativos", label: "Inativos" },
  { key: "conectados", label: "WhatsApp conectado" },
  { key: "desconectados", label: "Desconectados" },
];

export type AgentListItem = { agent: AgentCardData; stats: AgentCardStats; totalCostUsd: number };

// Cabeçalho (título + busca + filtro + botão de criar) e a lista de cards. Busca e filtro são só de
// tela — a lista de agentes de um workspace é curta e já vem inteira do servidor.
export function AgentsList({
  items,
  canManage,
  addAgent,
  attention,
}: {
  items: AgentListItem[];
  canManage: boolean;
  // Botão/modal de "Adicionar agente" (componente de servidor já montado com os números disponíveis).
  addAgent: React.ReactNode;
  // Painel de conversas que precisam de atenção — fica entre o cabeçalho e a lista, como antes.
  attention: React.ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("todos");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return items.filter(({ agent }) => {
      if (q && !agent.name.toLowerCase().includes(q) && !(digits && (agent.phone_number || "").includes(digits))) return false;
      const conn = connectionStateOf(agent);
      if (filter === "ativos") return agent.status === "ativo";
      if (filter === "inativos") return agent.status !== "ativo";
      if (filter === "conectados") return conn === "conectado";
      if (filter === "desconectados") return conn !== "conectado";
      return true;
    });
  }, [items, query, filter]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div className="min-w-0 xl:self-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Agentes</h1>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 shrink-0">
          <label className="relative flex items-center">
            <span className="sr-only">Buscar agente</span>
            <Search className="absolute left-3 w-4 h-4 text-text-muted pointer-events-none" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar agente..."
              className="w-full sm:w-60 min-h-10 pl-9 pr-3 rounded-lg border border-border bg-surface text-sm outline-none focus:border-primary"
            />
          </label>
          <label className="relative flex items-center">
            <span className="sr-only">Filtrar por status</span>
            <Filter className="absolute left-3 w-4 h-4 text-text-muted pointer-events-none" aria-hidden />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as StatusFilter)}
              className="w-full sm:w-52 min-h-10 pl-9 pr-3 rounded-lg border border-border bg-surface text-sm outline-none focus:border-primary cursor-pointer"
            >
              {FILTERS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          {canManage && addAgent}
        </div>
      </div>

      {attention}

      {items.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhum agente ainda</p>
          <p className="text-sm mt-1">Clique em &quot;Adicionar agente&quot; pra conectar o primeiro número.</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-surface border border-border rounded-xl p-8 text-center text-sm text-text-muted">Nenhum agente com esses filtros.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map(({ agent, stats, totalCostUsd }) => (
            <AgentCard key={agent.id} agent={agent} stats={stats} totalCostUsd={totalCostUsd} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
