"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { removeWhatsappInstance } from "@/app/actions/whatsapp";

// Remove o número da plataforma (não mexe na conta da Meta/360dialog). Confirmação na própria tela,
// explicando o que continua e o que sai — sem diálogo do navegador.
export function RemoveNumberButton({ instanceId, label }: { instanceId: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleRemove() {
    setError(null);
    startTransition(async () => {
      const r = await removeWhatsappInstance(instanceId);
      if (r.error) {
        setError(r.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 text-xs font-bold text-text-muted hover:text-danger cursor-pointer w-fit"
      >
        <Trash2 className="w-3.5 h-3.5" aria-hidden />
        Remover número
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-danger/30 bg-danger-soft/40 p-3 flex flex-col gap-2">
      <p className="text-xs font-bold text-text">Remover o número {label} da plataforma?</p>
      <p className="text-xs text-text-muted leading-relaxed">
        Contatos, conversas e campanhas continuam — só deixam de estar ligados a esse número. Não apaga nada na conta da
        Meta/360dialog. Pra usar de novo, é só conectar o número outra vez.
      </p>
      {error && <p className="text-xs text-danger font-semibold">{error}</p>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-md bg-danger text-white hover:opacity-90 cursor-pointer disabled:opacity-60"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden />
          {pending ? "Removendo…" : "Sim, remover"}
        </button>
        <button type="button" onClick={() => setConfirming(false)} disabled={pending} className="text-xs font-bold px-3 py-2 text-text-muted hover:text-text cursor-pointer">
          Cancelar
        </button>
      </div>
    </div>
  );
}
