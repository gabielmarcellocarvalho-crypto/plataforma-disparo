"use client";

import { useState } from "react";
import { TeamManager } from "@/components/team-manager";
import type { BranchRow, TeamMemberRow } from "@/app/actions/team";

type Tab = "pessoas" | "filiais" | "territorios" | "desempenho";

// Equipe em abas (Pessoas, Filiais, Territórios, Desempenho) em vez de uma página longa com tudo
// empilhado. Todos os painéis ficam montados e só trocam de visibilidade: o TeamManager guarda a lista
// local e o formulário em edição, e desmontar perderia isso ao trocar de aba.
export function EquipeShell({
  branches,
  members,
  territorios,
  desempenho,
}: {
  branches: BranchRow[];
  members: TeamMemberRow[];
  territorios: React.ReactNode;
  // null = ninguém ativo com leads ainda: a aba nem aparece.
  desempenho: React.ReactNode | null;
}) {
  const [tab, setTab] = useState<Tab>("pessoas");
  const tabs: [Tab, string][] = [
    ["pessoas", "Pessoas"],
    ["filiais", "Filiais"],
    ["territorios", "Territórios"],
    ...(desempenho ? ([["desempenho", "Desempenho"]] as [Tab, string][]) : []),
  ];

  return (
    <div className="flex flex-col gap-5">
      <nav className="flex gap-1 border-b border-border overflow-x-auto" aria-label="Seções da equipe">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={`-mb-px border-b-2 px-4 py-3 text-base font-semibold whitespace-nowrap cursor-pointer ${
              tab === key ? "border-primary-strong text-text" : "border-transparent text-text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <TeamManager branches={branches} members={members} view={tab === "filiais" || tab === "pessoas" ? tab : null} />
      <div className={tab === "territorios" ? "" : "hidden"}>{territorios}</div>
      {desempenho && <div className={tab === "desempenho" ? "" : "hidden"}>{desempenho}</div>}
    </div>
  );
}
