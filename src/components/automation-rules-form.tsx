"use client";

import { useState, useTransition } from "react";
import { updateAutomationRule, type AutomationRule } from "@/app/actions/automation-rules";
import type { AutomationRuleType } from "@/lib/automation-rules";

const RULE_COPY: Record<AutomationRuleType, { title: string; description: (days: number) => string }> = {
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
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-3 max-w-xl">
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-10 h-10 rounded-lg bg-primary-soft text-primary-strong shrink-0" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        </span>
        <h3 className="text-base font-bold flex-1">{copy.title}</h3>
        <label className="relative inline-flex items-center cursor-pointer shrink-0">
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

      <div className="flex items-center gap-2 border-t border-border pt-3">
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
        {saved && <span className="text-xs font-semibold text-success ml-1">Salvo.</span>}
        {error && <span className="text-xs text-danger font-medium ml-1">{error}</span>}
      </div>
    </div>
  );
}

export function AutomationRulesForm({ workspaceId, rules }: { workspaceId: string; rules: AutomationRule[] }) {
  return (
    <div className="flex flex-col gap-4">
      {rules.map((rule) => (
        <RuleCard key={rule.type} workspaceId={workspaceId} rule={rule} />
      ))}
    </div>
  );
}
