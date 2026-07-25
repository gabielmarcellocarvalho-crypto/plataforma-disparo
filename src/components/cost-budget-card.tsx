"use client";

import { useState, useTransition } from "react";
import { saveCostBudget } from "@/app/actions/workspace";

export function CostBudgetCard({
  workspaceId,
  costBrl,
  initialBudgetBrl,
  initialThresholdPct,
}: {
  workspaceId: string;
  costBrl: number;
  initialBudgetBrl: number | null;
  initialThresholdPct: number;
}) {
  const [budget, setBudget] = useState(initialBudgetBrl ? String(initialBudgetBrl) : "");
  const [threshold, setThreshold] = useState(initialThresholdPct);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const budgetNum = budget.trim() ? Number(budget.replace(",", ".")) : null;
  const hasBudget = budgetNum !== null && budgetNum > 0;
  const ratioPct = hasBudget ? (costBrl / budgetNum!) * 100 : null;
  const isOver = ratioPct !== null && ratioPct >= threshold;

  // Cor da barra: verde abaixo do limite, âmbar perto/no limite, vermelho estourando o orçamento.
  const barColor = ratioPct === null ? "bg-border" : ratioPct >= 100 ? "bg-danger" : isOver ? "bg-warning-text" : "bg-success";
  const barWidth = ratioPct === null ? 0 : Math.min(100, ratioPct);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveCostBudget(workspaceId, budgetNum, threshold);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-bold text-[15px]">Orçamento de custo de IA (mês)</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Alerta quando o custo de IA desse cliente no mês passa do limite. Só o custo de IA (tokens) — canal é à parte.
          </p>
        </div>
        <div className="text-right">
          <div className="text-lg font-extrabold">R$ {costBrl.toFixed(2)}</div>
          <div className="text-xs text-text-muted">gasto este mês</div>
        </div>
      </div>

      {hasBudget && (
        <div className="mt-4">
          <div className="h-2.5 w-full rounded-full bg-bg overflow-hidden">
            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-xs">
            <span className={isOver ? "font-bold text-danger" : "text-text-muted"}>
              {ratioPct!.toFixed(0)}% de R$ {budgetNum!.toFixed(2)}
            </span>
            {isOver && <span className="font-bold text-danger">passou de {threshold}%</span>}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-[1fr_1fr_auto] gap-3 items-end mt-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-muted">Orçamento mensal (R$)</label>
          <input
            value={budget}
            onChange={(e) => {
              setBudget(e.target.value.replace(/[^0-9.,]/g, ""));
              setSaved(false);
            }}
            inputMode="decimal"
            placeholder="ex: 800"
            className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-semibold text-text-muted">Alertar ao atingir (%)</label>
          <input
            type="number"
            min={1}
            max={100}
            value={threshold}
            onChange={(e) => {
              setThreshold(Number(e.target.value));
              setSaved(false);
            }}
            className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
          >
            Salvar
          </button>
          {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
          {error && <span className="text-xs text-danger font-medium">{error}</span>}
        </div>
      </div>
      <p className="text-xs text-text-muted mt-2">Deixe o orçamento em branco pra desligar o alerta deste cliente.</p>
    </div>
  );
}
