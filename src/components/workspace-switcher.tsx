"use client";

import { setActiveWorkspace } from "@/app/actions/workspace";
import type { WorkspaceSummary } from "@/lib/workspace";

export function WorkspaceSwitcher({
  workspaces,
  currentId,
}: {
  workspaces: WorkspaceSummary[];
  currentId: string;
}) {
  return (
    <select
      value={currentId}
      onChange={(e) => setActiveWorkspace(e.target.value)}
      className="w-full bg-surface border border-border rounded-md text-sm font-bold px-2.5 py-2 outline-none focus:border-primary"
      aria-label="Selecionar workspace"
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
