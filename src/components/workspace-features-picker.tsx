"use client";

import { useState, useTransition } from "react";
import { PAGE_CATALOG, ACCESS_TYPES, hiddenPagesForPlan, type AccessType } from "@/lib/access-types";
import { updateWorkspaceFeatures } from "@/app/actions/workspace";

// Marcado = função LIGADA. A lista gravada é a das desligadas (hidden_pages), mas a caixa mostra o
// que o cliente tem — ninguém pensa "quero ocultar Campanhas", pensa "esse cliente usa Campanhas".
function Lista({
  hidden,
  onToggle,
  onPreset,
}: {
  hidden: string[];
  onToggle: (path: string) => void;
  onPreset: (plan: AccessType) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] font-semibold text-text-muted mr-1">Começar de um plano:</span>
        {ACCESS_TYPES.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPreset(p.key)}
            className="text-[11px] font-bold px-2.5 py-1 rounded-full border border-border text-text-muted
              hover:border-primary-soft hover:text-primary-strong transition-colors cursor-pointer"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Uma coluna no celular, duas a partir de sm: são 10 linhas, e em telas largas uma coluna só
          deixaria um rio de espaço vazio à direita. */}
      <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
        {PAGE_CATALOG.map((item) => {
          const ligado = !hidden.includes(item.path);
          return (
            <label
              key={item.path}
              className="flex items-start gap-2.5 py-2 cursor-pointer rounded-md px-1.5 -mx-1.5 hover:bg-surface-2 transition-colors"
            >
              <input
                type="checkbox"
                checked={ligado}
                onChange={() => onToggle(item.path)}
                className="mt-0.5 cursor-pointer accent-[var(--color-primary-strong)]"
              />
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${ligado ? "" : "text-text-muted line-through"}`}>{item.label}</span>
                <span className="block text-[11px] text-text-muted leading-snug">{item.hint}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-[11px] text-text-muted">
        Visão geral e Configurações não podem ser desligadas — sem elas o cliente não entra nem
        reconecta o próprio número. Desligar vale pra todo mundo do workspace, inclusive a agência.
      </p>
    </div>
  );
}

// Usado no formulário de criação: não salva sozinho, só alimenta um input hidden do form.
export function WorkspaceFeaturesField({ initialHidden = [] }: { initialHidden?: string[] }) {
  const [hidden, setHidden] = useState<string[]>(initialHidden);

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-semibold">Funções ativas</span>
      <input type="hidden" name="hiddenPages" value={JSON.stringify(hidden)} />
      <Lista
        hidden={hidden}
        onToggle={(path) => setHidden((h) => (h.includes(path) ? h.filter((p) => p !== path) : [...h, path]))}
        onPreset={(plan) => setHidden(hiddenPagesForPlan(plan))}
      />
    </div>
  );
}

// Usado em Configurações, num workspace que já existe: salva na hora.
export function WorkspaceFeaturesEditor({ workspaceId, initialHidden }: { workspaceId: string; initialHidden: string[] }) {
  const [hidden, setHidden] = useState<string[]>(initialHidden);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [pending, startTransition] = useTransition();

  function aplicar(próximo: string[]) {
    setHidden(próximo);
    setErro(null);
    setSalvo(false);
    startTransition(async () => {
      const r = await updateWorkspaceFeatures(workspaceId, próximo);
      if (r.error) setErro(r.error);
      else setSalvo(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Lista
        hidden={hidden}
        onToggle={(path) => aplicar(hidden.includes(path) ? hidden.filter((p) => p !== path) : [...hidden, path])}
        onPreset={(plan) => aplicar(hiddenPagesForPlan(plan))}
      />
      <div className="min-h-[18px]">
        {pending && <span className="text-xs text-text-muted">Salvando…</span>}
        {!pending && salvo && <span className="text-xs font-semibold text-success">Salvo — o menu já reflete a mudança.</span>}
        {erro && <span className="text-xs text-danger font-medium">{erro}</span>}
      </div>
    </div>
  );
}
