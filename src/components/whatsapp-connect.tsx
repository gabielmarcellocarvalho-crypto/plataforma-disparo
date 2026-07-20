"use client";

import { useState, useTransition } from "react";
import { connectWhatsapp, refreshWhatsappStatus } from "@/app/actions/whatsapp";

export function WhatsappConnect({ initialStatus }: { initialStatus: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleConnect = () => {
    setError(null);
    startTransition(async () => {
      const result = await connectWhatsapp();
      if (result.error) setError(result.error);
      else setQr(result.qrcodeBase64 ?? null);
    });
  };

  const handleRefresh = () => {
    startTransition(async () => {
      await refreshWhatsappStatus();
    });
  };

  const connected = initialStatus === "open";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className={`text-sm font-bold ${connected ? "text-success" : "text-text-muted"}`}>
          {connected ? "✓ conectado" : initialStatus}
        </span>
        <button
          onClick={handleRefresh}
          disabled={pending}
          className="text-xs font-semibold text-primary-strong hover:underline disabled:opacity-60"
        >
          Atualizar status
        </button>
      </div>

      {!connected && (
        <button
          onClick={handleConnect}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit disabled:opacity-60"
        >
          {pending ? "Gerando QR…" : "Conectar WhatsApp"}
        </button>
      )}

      {error && <p className="text-sm text-danger font-medium">{error}</p>}

      {qr && !connected && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-text-muted">Escaneie com o WhatsApp do cliente (Aparelhos conectados → Conectar um aparelho):</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code de conexão do WhatsApp" className="w-56 h-56 border border-border rounded-lg" />
          <p className="text-xs text-text-muted">Depois de escanear, clique em &quot;Atualizar status&quot;.</p>
        </div>
      )}
    </div>
  );
}
