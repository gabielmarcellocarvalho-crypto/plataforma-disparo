"use client";

import { useState, useTransition } from "react";
import { activateCampaign, pauseCampaign } from "@/app/actions/campaigns";

export function CampaignRowActions({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [onlyAbordados, setOnlyAbordados] = useState(false);
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

  function handleConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await activateCampaign(id, {
        onlyAbordados,
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
      <label className="flex items-center gap-2 text-xs font-semibold w-full cursor-pointer">
        <input type="checkbox" checked={onlyAbordados} onChange={(e) => setOnlyAbordados(e.target.checked)} />
        Só leads já abordados no CRM (exclui descartados)
      </label>
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
