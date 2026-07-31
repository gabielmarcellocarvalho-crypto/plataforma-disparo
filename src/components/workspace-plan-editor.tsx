"use client";

import { useTransition } from "react";
import { updateWorkspacePlan } from "@/app/actions/workspace";
import { WORKSPACE_PLANS, type WorkspacePlan } from "@/lib/workspace-plan";

export function WorkspacePlanEditor({ workspaceId, currentPlan }: { workspaceId: string; currentPlan: WorkspacePlan }) {
  const [pending, startTransition] = useTransition();

  function handleSelect(plan: WorkspacePlan) {
    if (plan === currentPlan) return;
    startTransition(async () => {
      await updateWorkspacePlan(workspaceId, plan);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {WORKSPACE_PLANS.map((p) => {
        const active = currentPlan === p.key;
        return (
          <button
            key={p.key}
            type="button"
            disabled={pending}
            onClick={() => handleSelect(p.key)}
            className={`text-left p-3 rounded-lg border cursor-pointer transition-colors disabled:opacity-60 ${
              active ? "border-primary-strong bg-primary-faint" : "border-border hover:border-primary-soft"
            }`}
          >
            <div className={`text-sm font-bold ${active ? "text-primary-strong" : ""}`}>{p.label}</div>
            <div className="text-[11px] text-text-muted mt-0.5 leading-snug">{p.short}</div>
          </button>
        );
      })}
    </div>
  );
}
