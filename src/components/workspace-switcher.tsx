"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { setActiveWorkspace, deleteWorkspace } from "@/app/actions/workspace";
import type { WorkspaceSummary } from "@/lib/workspace";

function ChevronUpDownIcon() {
  return (
    <svg width="10" height="14" viewBox="0 0 8 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M0.5 4.5L4 1.5L7.5 4.5" />
      <path d="M0.5 7.5L4 10.5L7.5 7.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg fill="currentColor" width="11" height="11" viewBox="0 0 10 10" aria-hidden>
      <path d="M9.1603 1.12218C9.50684 1.34873 9.60427 1.81354 9.37792 2.16038L5.13603 8.66012C5.01614 8.8438 4.82192 8.96576 4.60451 8.99384C4.3871 9.02194 4.1683 8.95335 4.00574 8.80615L1.24664 6.30769C0.939709 6.02975 0.916013 5.55541 1.19372 5.24822C1.47142 4.94102 1.94536 4.91731 2.2523 5.19524L4.36085 7.10461L8.12299 1.33999C8.34934 0.993152 8.81376 0.895638 9.1603 1.12218Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

export function WorkspaceSwitcher({ workspaces, currentId }: { workspaces: WorkspaceSummary[]; currentId: string }) {
  const [open, setOpen] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);

  const current = workspaces.find((w) => w.id === currentId);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingId(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setConfirmingId(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleSwitch(id: string) {
    if (id === currentId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await setActiveWorkspace(id);
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteWorkspace(id);
      if (result.error) setError(result.error);
      else {
        setConfirmingId(null);
        setOpen(false);
      }
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 rounded-md bg-white/[0.06] border border-sidebar-border px-3 py-2 text-sm font-bold text-white select-none hover:bg-white/10 transition-colors cursor-pointer"
      >
        <span className="truncate">{current?.name ?? "Selecionar cliente"}</span>
        <span className="text-sidebar-muted shrink-0">
          <ChevronUpDownIcon />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute bottom-full left-0 right-0 mb-2 z-50 max-h-72 overflow-y-auto rounded-lg bg-surface py-1 text-text shadow-lg border border-border"
        >
          {workspaces.map((w) => {
            const active = w.id === currentId;
            const confirming = confirmingId === w.id;
            return (
              <div
                key={w.id}
                className={`group flex items-center gap-1 px-1.5 ${active ? "" : "hover:bg-primary-faint"} ${confirming ? "bg-danger-soft" : ""}`}
              >
                {confirming ? (
                  <div className="flex items-center justify-between gap-2 w-full px-1.5 py-2">
                    <span className="text-xs font-semibold text-danger truncate">Apagar tudo de &quot;{w.name}&quot;?</span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={pending}
                        className="text-xs font-bold px-2 py-1 rounded text-text-muted hover:bg-bg cursor-pointer"
                      >
                        Não
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(w.id)}
                        disabled={pending}
                        className="text-xs font-bold px-2 py-1 rounded bg-danger text-white cursor-pointer disabled:opacity-60"
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => handleSwitch(w.id)}
                      role="option"
                      aria-selected={active}
                      className="flex flex-1 items-center gap-2 py-2 pl-1.5 pr-1 text-sm text-left cursor-pointer min-w-0"
                    >
                      <span className={`w-3.5 shrink-0 ${active ? "text-primary-strong" : "text-transparent"}`}>
                        <CheckIcon />
                      </span>
                      <span className={`truncate ${active ? "font-bold text-primary-strong" : "font-semibold"}`}>{w.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingId(w.id)}
                      aria-label={`Remover workspace ${w.name}`}
                      className="shrink-0 p-1.5 rounded text-text-muted opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger-soft transition-all cursor-pointer"
                    >
                      <TrashIcon />
                    </button>
                  </>
                )}
              </div>
            );
          })}
          {error && <p className="text-xs text-danger font-medium px-3 py-1.5">{error}</p>}
        </div>
      )}
    </div>
  );
}
