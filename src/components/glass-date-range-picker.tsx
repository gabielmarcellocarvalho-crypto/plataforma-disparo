"use client";

import { useEffect, useRef, useState } from "react";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";
import { GlassCalendar } from "@/components/glass-calendar";

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
      aria-hidden
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

export function formatBr(key: string) {
  const [y, m, d] = key.split("-");
  return `${d}/${m}/${y}`;
}

// Dropdown de período em "vidro líquido": botão-gatilho discreto + painel com calendário navegável
// (clica no dia inicial e no final) sobre manchas roxas borradas atrás de uma superfície translúcida.
// Reaproveitado tanto no filtro global (Visão geral/Métricas, via PeriodFilterBar) quanto no filtro
// de data de entrada do CRM — cada um decide o que fazer com o range escolhido (`onApplyRange`).
export function GlassDateRangePicker({
  triggerLabel,
  activePreset,
  from,
  to,
  showPresets = true,
  allowClear = false,
  onApplyPreset,
  onApplyRange,
  onClear,
}: {
  triggerLabel: string;
  activePreset?: PeriodPreset | null;
  from: string;
  to: string;
  showPresets?: boolean;
  allowClear?: boolean;
  onApplyPreset?: (preset: PeriodPreset) => void;
  onApplyRange: (from: string, to: string) => void;
  onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selStart, setSelStart] = useState<string | null>(from || null);
  const [selEnd, setSelEnd] = useState<string | null>(to || null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelStart(from || null);
    setSelEnd(to || null);
  }, [from, to]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  function handlePreset(preset: PeriodPreset) {
    onApplyPreset?.(preset);
    setOpen(false);
  }

  function handleCalendarChange(start: string | null, end: string | null) {
    setSelStart(start);
    setSelEnd(end);
    if (start && end) {
      onApplyRange(start, end);
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold cursor-pointer transition-colors ${
          open ? "border-primary text-primary-strong bg-primary-faint" : "border-border bg-surface text-text hover:border-primary-soft"
        }`}
      >
        <span className="text-primary" aria-hidden>
          <CalendarIcon />
        </span>
        {triggerLabel}
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute z-50 mt-2 left-0 w-[300px] rounded-2xl border border-white/70 shadow-2xl overflow-hidden">
          <div className="absolute inset-0">
            <div className="absolute -top-10 -right-10 w-36 h-36 rounded-full bg-primary opacity-40 blur-2xl" />
            <div className="absolute -bottom-12 -left-10 w-40 h-40 rounded-full bg-primary-strong opacity-35 blur-2xl" />
          </div>

          <div className="relative bg-white/70 backdrop-blur-xl p-3">
            {showPresets && (
              <div className="flex flex-wrap gap-1 mb-2 pb-2 border-b border-white/60">
                {PERIOD_PRESETS.map((p) => {
                  const active = activePreset === p.key;
                  return (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => handlePreset(p.key)}
                      className={`text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer transition-colors ${
                        active ? "bg-primary-strong text-white" : "bg-white/60 text-text-muted hover:bg-white/90 hover:text-primary-strong"
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}

            <GlassCalendar start={selStart} end={selEnd} onChange={handleCalendarChange} />

            <div className="flex items-center justify-between mt-1">
              <p className="text-[11px] text-text-muted">
                {selStart && !selEnd ? "Escolha a data final" : "Clique num dia pra começar"}
              </p>
              {allowClear && (from || to) && (
                <button
                  type="button"
                  onClick={() => {
                    onClear?.();
                    setSelStart(null);
                    setSelEnd(null);
                    setOpen(false);
                  }}
                  className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
