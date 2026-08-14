"use client";

import { useState } from "react";
import Link from "next/link";
import { WhatsappConnect } from "@/components/whatsapp-connect";
import { Dialog360Connect } from "@/components/dialog360-connect";

// Antes de conectar um número novo, força a escolha explícita entre disparo em massa (sem IA,
// fica aqui em Configurações) e agente de IA (número próprio + prompt, gerenciado em /agentes).
// Isso existe porque os dois fluxos viviam em telas separadas sem deixar claro qual escolher.
export function WhatsappConnectChooser({
  hasExistingInstance,
  initialStatus,
  existingChannel,
  existingDepartment,
}: {
  hasExistingInstance: boolean;
  initialStatus: string;
  existingChannel: "evolution" | "360dialog" | null;
  existingDepartment: string | null;
}) {
  const [choice, setChoice] = useState<"disparo" | "agente" | null>(hasExistingInstance ? "disparo" : null);
  // Se já existe instância, o canal é fixo (o que já foi conectado); senão, deixa escolher.
  const [channel, setChannel] = useState<"evolution" | "360dialog">(existingChannel || "evolution");

  if (choice === "disparo") {
    if (!hasExistingInstance) {
      return (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            {(["evolution", "360dialog"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`flex-1 text-xs font-bold px-3 py-2 rounded-md border cursor-pointer ${
                  channel === c ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
                }`}
              >
                {c === "evolution" ? "Evolution (não oficial)" : "360dialog (API oficial)"}
              </button>
            ))}
          </div>
          {channel === "evolution" ? <WhatsappConnect initialStatus={initialStatus} /> : <Dialog360Connect connected={false} department={null} />}
        </div>
      );
    }
    return existingChannel === "360dialog" ? (
      <Dialog360Connect connected={initialStatus === "conectado"} department={existingDepartment} />
    ) : (
      <WhatsappConnect initialStatus={initialStatus} />
    );
  }

  if (choice === "agente") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-text-muted">
          Números com IA são criados e conectados na tela de Agentes, cada um com seu prompt.
        </p>
        <Link href="/agentes" className="text-sm font-bold text-primary-strong hover:underline w-fit">
          Ir pra Agentes →
        </Link>
        <button type="button" onClick={() => setChoice(null)} className="text-xs text-text-muted hover:underline w-fit mt-1">
          Voltar
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-text-muted">Esse número novo vai ser usado pra:</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setChoice("disparo")}
          className="border border-border rounded-lg p-4 text-left hover:border-primary hover:bg-primary-faint cursor-pointer transition-colors"
        >
          <div className="font-bold text-sm mb-1">Disparo em massa</div>
          <div className="text-xs text-text-muted">Envia campanhas em lote, sem IA respondendo. Só esse número, sem prompt.</div>
        </button>
        <button
          type="button"
          onClick={() => setChoice("agente")}
          className="border border-border rounded-lg p-4 text-left hover:border-primary hover:bg-primary-faint cursor-pointer transition-colors"
        >
          <div className="font-bold text-sm mb-1">Agente de IA</div>
          <div className="text-xs text-text-muted">Número próprio que responde sozinho, seguindo um prompt configurável.</div>
        </button>
      </div>
    </div>
  );
}
