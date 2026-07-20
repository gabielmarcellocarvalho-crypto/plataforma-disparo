"use client";

import { useState, useTransition } from "react";
import { activateCampaign, pauseCampaign } from "@/app/actions/campaigns";

export function CampaignRowActions({ id, status }: { id: string; status: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={() =>
          startTransition(async () => {
            const result = await activateCampaign(id);
            setError(result.error);
          })
        }
        disabled={pending}
        className="text-xs font-bold text-primary-strong hover:underline disabled:opacity-60"
      >
        {pending ? "Ativando…" : "Ativar disparo"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
