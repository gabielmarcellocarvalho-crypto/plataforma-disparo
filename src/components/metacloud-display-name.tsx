"use client";

import { useEffect, useState, useTransition } from "react";
import { getInstanceDisplayName, updateInstanceDisplayName } from "@/app/actions/whatsapp";

type DisplayName = { verifiedName: string | null; nameStatus: string | null; newNameStatus: string | null };

// Rótulo humano pros status crus da Meta. Só aparece quando tem algo pra dizer — nome já aprovado e
// sem pedido aberto é o caso normal, não precisa de selo.
function StatusBadge({ name }: { name: DisplayName }) {
  const pending = name.newNameStatus === "PENDING_REVIEW" || name.nameStatus === "PENDING_REVIEW";
  const declined = name.newNameStatus === "DECLINED" || name.nameStatus === "DECLINED";

  if (pending) {
    return (
      <span className="text-[10px] font-bold uppercase bg-warning-soft text-warning-text px-2 py-0.5 rounded-full">
        em análise na Meta
      </span>
    );
  }
  if (declined) {
    return <span className="text-[10px] font-bold uppercase bg-danger-soft text-danger px-2 py-0.5 rounded-full">recusado</span>;
  }
  return null;
}

// Nome de exibição do número no WhatsApp — fica logo abaixo da foto de perfil, no mesmo bloco, já
// que são as duas coisas que o cliente vê no topo da conversa. Diferente da foto, a troca não é
// imediata: passa pela revisão da Meta.
export function MetacloudDisplayName({ instanceId }: { instanceId: string }) {
  const [name, setName] = useState<DisplayName | null | undefined>(undefined); // undefined = carregando
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getInstanceDisplayName(instanceId).then((r) => setName(r.name ?? null));
  }, [instanceId]);

  function startEditing() {
    setValue(name?.verifiedName ?? "");
    setError(null);
    setSent(false);
    setEditing(true);
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateInstanceDisplayName(instanceId, value);
      if (result.name) setName(result.name);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSent(true);
      setEditing(false);
    });
  }

  if (name === undefined) return null; // ainda carregando — não pisca um estado errado
  if (name === null) return null; // número sem nome legível na Meta (não conectado ainda, sem permissão)

  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-3 mt-3">
      <span className="text-xs font-bold text-text-muted">Nome que aparece no WhatsApp</span>

      {!editing ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{name.verifiedName || "—"}</span>
          <StatusBadge name={name} />
          <button
            type="button"
            onClick={startEditing}
            className="text-xs font-bold text-primary-strong hover:underline cursor-pointer"
          >
            Trocar
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            maxLength={25}
            placeholder="Nome da empresa"
            className="border border-border rounded-md px-2 py-1.5 text-sm w-56 outline-none focus:border-primary"
          />
          <span className="text-[11px] text-text-muted">{value.trim().length}/25</span>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="text-xs font-bold px-3 py-1.5 rounded-md bg-primary-strong text-white cursor-pointer disabled:opacity-60"
          >
            {pending ? "Enviando…" : "Pedir troca"}
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            disabled={pending}
            className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer disabled:opacity-60"
          >
            Cancelar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-danger font-medium">{error}</p>}
      {sent && (
        <p className="text-xs font-semibold text-success">
          Pedido enviado. A Meta revisa e o nome só troca no WhatsApp do cliente depois que ela aprovar.
        </p>
      )}
      <p className="text-[11px] text-text-muted">
        Até 25 caracteres e precisa ter relação com a empresa — quem aprova é a Meta, não a plataforma. A revisão costuma
        levar de alguns minutos a alguns dias, e o nome antigo continua valendo até lá.
      </p>
    </div>
  );
}
