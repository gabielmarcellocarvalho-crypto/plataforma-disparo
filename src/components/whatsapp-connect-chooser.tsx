"use client";

import { useState } from "react";
import Link from "next/link";
import { WhatsappConnect } from "@/components/whatsapp-connect";

// Antes de conectar um número novo, força a escolha explícita entre disparo em massa (sem IA,
// fica aqui em Configurações) e agente de IA (número próprio + prompt, gerenciado em /agentes).
// Isso existe porque os dois fluxos viviam em telas separadas sem deixar claro qual escolher.
export function WhatsappConnectChooser({ hasExistingInstance, initialStatus }: { hasExistingInstance: boolean; initialStatus: string }) {
  const [choice, setChoice] = useState<"disparo" | "agente" | null>(hasExistingInstance ? "disparo" : null);

  if (choice === "disparo") {
    return <WhatsappConnect initialStatus={initialStatus} />;
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
