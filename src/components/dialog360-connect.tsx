"use client";

import { useState, useTransition } from "react";
import { connectDialog360 } from "@/app/actions/whatsapp";

// Conectar via 360dialog não tem QR code — a API key e o phone_number_id vêm do painel do 360dialog
// (depois que o número já foi verificado e o template aprovado pela Meta, isso é feito fora daqui).
export function Dialog360Connect({
  instanceId,
  connected,
  department: initialDepartment,
}: {
  instanceId: string | null;
  connected: boolean;
  department: string | null;
}) {
  const [department, setDepartment] = useState(initialDepartment || "vendas");
  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await connectDialog360(instanceId, department, apiKey, phoneNumberId);
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {connected && <p className="text-sm font-bold text-success">✓ conectado via 360dialog</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-muted">Departamento</span>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary w-fit"
        >
          <option value="vendas">Vendas</option>
          <option value="financeiro">Financeiro</option>
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-muted">API key (D360-API-KEY)</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={instanceId ? "•••••••• (deixe em branco pra manter a atual)" : "Gerada no painel do 360dialog"}
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary font-mono"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-muted">Phone number ID</span>
        <input
          value={phoneNumberId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          placeholder={instanceId ? "(deixe em branco pra manter o atual)" : "Vem do painel do 360dialog/Meta"}
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary font-mono"
        />
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
        >
          {pending ? "Salvando…" : "Salvar e conectar"}
        </button>
        {saved && <span className="text-xs font-semibold text-success">Salvo — webhook registrado (ou configure manualmente se falhar).</span>}
      </div>
      {error && <p className="text-sm text-danger font-medium">{error}</p>}
      <p className="text-xs text-text-muted">
        Pré-requisito: número já verificado e com pelo menos um template de mensagem aprovado pela Meta no painel do
        360dialog — isso não é feito por aqui.
      </p>
    </div>
  );
}
