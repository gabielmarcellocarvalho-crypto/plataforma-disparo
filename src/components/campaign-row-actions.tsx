"use client";

import { useState, useTransition } from "react";
import { activateCampaign, pauseCampaign } from "@/app/actions/campaigns";

export type StageOption = { value: string; label: string };

export function CampaignRowActions({ id, status, stages }: { id: string; status: string; stages: StageOption[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set());
  const [sinceDays, setSinceDays] = useState("");

  if (status === "ativa") {
    return (
      <button
        onClick={() => startTransition(() => pauseCampaign(id))}
        disabled={pending}
        className="text-xs font-bold text-text-muted hover:text-text disabled:opacity-60"
      >
        Pausar
      </button>
    );
  }

  function toggleStage(value: string) {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await activateCampaign(id, {
        stages: Array.from(selectedStages),
        sinceDays: sinceDays.trim() ? Number(sinceDays) : null,
      });
      setError(result.error);
      if (!result.error) setOptionsOpen(false);
    });
  }

  if (!optionsOpen) {
    return (
      <button
        type="button"
        onClick={() => setOptionsOpen(true)}
        className="text-xs font-bold text-primary-strong hover:underline cursor-pointer"
      >
        Ativar disparo
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2 text-left bg-surface-2 border border-border rounded-lg p-3 w-72">
      <div className="w-full">
        <span className="text-xs font-semibold block mb-1.5">Fases do CRM (nenhuma marcada = todas)</span>
        {stages.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma fase visível no CRM desse workspace.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {stages.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={selectedStages.has(s.value)} onChange={() => toggleStage(s.value)} />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs font-semibold w-full">
        Só quem mudou de fase nos últimos
        <input
          type="number"
          min={1}
          value={sinceDays}
          onChange={(e) => setSinceDays(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="90"
          className="w-14 border border-border rounded-md px-1.5 py-1 text-xs outline-none focus:border-primary"
        />
        dias
      </label>
      <div className="flex items-center gap-2 w-full justify-end pt-1">
        <button type="button" onClick={() => setOptionsOpen(false)} disabled={pending} className="text-xs font-semibold text-text-muted cursor-pointer disabled:opacity-60">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="bg-primary-strong text-white text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
        >
          {pending ? "Ativando…" : "Confirmar ativação"}
        </button>
      </div>
      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
}
