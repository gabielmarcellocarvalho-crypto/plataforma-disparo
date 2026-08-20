"use client";

import { useState, useTransition } from "react";
import { updateEmailFrom } from "@/app/actions/workspace";

export function EmailFromEditor({ workspaceId, current }: { workspaceId: string; current: string | null }) {
  const [value, setValue] = useState(current || "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await updateEmailFrom(workspaceId, value);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-muted">Remetente</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder='Ex.: TB Rio <contato@tbrioelevadores2.com.br>'
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary font-mono"
        />
      </label>
      <p className="text-xs text-text-muted">O domínio do e-mail precisa estar verificado no Resend, senão o envio falha.</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar"}
        </button>
        {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
      </div>
      {error && <p className="text-sm text-danger font-medium">{error}</p>}
    </div>
  );
}
