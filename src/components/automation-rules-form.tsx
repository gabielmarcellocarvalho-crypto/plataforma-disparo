"use client";

import { useState, useTransition } from "react";
import { updateAutomationRule, type AutomationRule } from "@/app/actions/automation-rules";
import type { AutomationRuleType } from "@/lib/automation-rules";

const RULE_COPY: Record<AutomationRuleType, { title: string; description: (days: number) => string }> = {
  deal_stale: {
    title: "Negócio parado",
    description: (days) => `Quando um negócio aberto ficar ${days} dia(s) sem mudar de estágio, cria uma tarefa de follow-up automaticamente.`,
  },
  contact_stale: {
    title: "Contato parado",
    description: (days) => `Quando um contato (fora concluído/descartado) ficar ${days} dia(s) sem mudar de fase, cria uma tarefa de follow-up automaticamente.`,
  },
};

function RuleCard({ workspaceId, rule }: { workspaceId: string; rule: AutomationRule }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [days, setDays] = useState(rule.days_threshold);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(nextEnabled: boolean, nextDays: number) {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await updateAutomationRule(workspaceId, rule.type, { enabled: nextEnabled, daysThreshold: nextDays });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  const copy = RULE_COPY[rule.type];

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-bold">{copy.title}</h3>
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              save(e.target.checked, days);
            }}
            className="sr-only peer"
          />
          <div className="w-10 h-[22px] bg-bg rounded-full peer-checked:bg-primary-strong transition-colors border border-border" />
          <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform peer-checked:translate-x-[18px]" />
        </label>
      </div>

      <p className="text-sm text-text-muted">{copy.description(days)}</p>

      <div className="flex items-center gap-2">
        <label className="text-xs font-semibold text-text-muted">Dias parado:</label>
        <input
          type="number"
          min={1}
          value={days}
          onChange={(e) => setDays(Number(e.target.value) || 1)}
          onBlur={() => save(enabled, days)}
          disabled={pending}
          className="w-20 border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-60"
        />
      </div>

      {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
}

export function AutomationRulesForm({ workspaceId, rules }: { workspaceId: string; rules: AutomationRule[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {rules.map((rule) => (
        <RuleCard key={rule.type} workspaceId={workspaceId} rule={rule} />
      ))}
    </div>
  );
}
