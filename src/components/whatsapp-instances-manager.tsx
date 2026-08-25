"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { WhatsappConnect } from "@/components/whatsapp-connect";
import { Dialog360Connect } from "@/components/dialog360-connect";
import { MetacloudConnect } from "@/components/metacloud-connect";
import { MetacloudProfilePhoto } from "@/components/metacloud-profile-photo";
import { isOfficialWhatsappChannel, type WhatsappChannel } from "@/lib/whatsapp-channel";

const DEPARTMENT_LABEL: Record<string, string> = { vendas: "Vendas", financeiro: "Financeiro" };
const ALL_DEPARTMENTS = ["vendas", "financeiro"];

export type WhatsappInstanceRow = {
  id: string;
  channel: WhatsappChannel;
  department: string;
  connection_status: string;
};

// Lista todos os números conectados do workspace (um workspace pode ter mais de um — ex.: Vendas +
// Financeiro, cada um com seu próprio número/departamento) e permite adicionar um número novo.
// Evolution (Baileys) continua limitado a 1 número por workspace (o nome da instância é derivado
// só do workspace_id, sem conceito de departamento) — só 360dialog suporta múltiplos números aqui.
export function WhatsappInstancesManager({
  initialInstances,
}: {
  initialInstances: WhatsappInstanceRow[];
}) {
  const [addingNew, setAddingNew] = useState(false);
  const hasEvolution = initialInstances.some((i) => i.channel === "evolution");
  const usedDepartments = new Set(initialInstances.map((i) => i.department));
  const availableDepartments = ALL_DEPARTMENTS.filter((d) => !usedDepartments.has(d));
  const isFirstNumber = initialInstances.length === 0;

  return (
    <div className="flex flex-col gap-5">
      {initialInstances.map((instance) => (
        <div key={instance.id} className={initialInstances.length > 1 ? "border border-border rounded-lg p-4" : ""}>
          {initialInstances.length > 1 && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold">{DEPARTMENT_LABEL[instance.department] || instance.department}</span>
              <span className="text-[10px] font-bold uppercase text-text-muted bg-bg px-2 py-0.5 rounded-full">
                {instance.channel === "metacloud" ? "API oficial (Meta)" : instance.channel === "360dialog" ? "API oficial (360dialog)" : "Evolution"}
              </span>
            </div>
          )}
          {instance.channel === "360dialog" ? (
            <Dialog360Connect instanceId={instance.id} connected={instance.connection_status === "conectado"} department={instance.department} />
          ) : instance.channel === "metacloud" ? (
            <>
              <p className="text-sm font-bold text-success">✓ conectado direto via Meta</p>
              <MetacloudProfilePhoto instanceId={instance.id} />
            </>
          ) : (
            <WhatsappConnect initialStatus={instance.connection_status} />
          )}
        </div>
      ))}

      {!addingNew && (isFirstNumber || (!hasEvolution && availableDepartments.length > 0)) && (
        <button
          type="button"
          onClick={() => setAddingNew(true)}
          className="text-sm font-bold text-primary-strong hover:underline w-fit"
        >
          + Adicionar {isFirstNumber ? "número" : "outro número"}
        </button>
      )}

      {addingNew && <AddNumberForm isFirstNumber={isFirstNumber} availableDepartments={availableDepartments} onCancel={() => setAddingNew(false)} />}

      {!isFirstNumber && !hasEvolution && availableDepartments.length === 0 && !addingNew && (
        <p className="text-xs text-text-muted">Todos os departamentos (Vendas, Financeiro) já têm número conectado.</p>
      )}
    </div>
  );
}

function AddNumberForm({
  isFirstNumber,
  availableDepartments,
  onCancel,
}: {
  isFirstNumber: boolean;
  availableDepartments: string[];
  onCancel: () => void;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<"disparo" | "agente" | null>(null);
  const [channel, setChannel] = useState<WhatsappChannel>("metacloud");
  const [department, setDepartment] = useState(availableDepartments[0] || "vendas");

  function handleConnected() {
    router.refresh();
    onCancel();
  }

  // Fluxo do PRIMEIRO número do workspace: escolhe se é disparo em massa ou agente de IA (agente
  // vive em /agentes, não aqui) e, se disparo, escolhe o canal (Meta, 360dialog ou Evolution).
  if (isFirstNumber) {
    if (choice === "agente") {
      return (
        <div className="flex flex-col gap-2 border border-border rounded-lg p-4">
          <p className="text-sm text-text-muted">Números com IA são criados e conectados na tela de Agentes, cada um com seu prompt.</p>
          <Link href="/agentes" className="text-sm font-bold text-primary-strong hover:underline w-fit">
            Ir pra Agentes →
          </Link>
          <button type="button" onClick={onCancel} className="text-xs text-text-muted hover:underline w-fit mt-1">
            Cancelar
          </button>
        </div>
      );
    }
    if (choice === "disparo") {
      return (
        <div className="flex flex-col gap-3 border border-border rounded-lg p-4">
          <div className="flex gap-2">
            {(["metacloud", "360dialog", "evolution"] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setChannel(c)}
                className={`flex-1 text-xs font-bold px-3 py-2 rounded-md border cursor-pointer ${
                  channel === c ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
                }`}
              >
                {c === "metacloud" ? "Meta (API oficial)" : c === "360dialog" ? "360dialog (API oficial)" : "Evolution (não oficial)"}
              </button>
            ))}
          </div>
          {channel === "evolution" ? (
            <WhatsappConnect initialStatus="desconectado" />
          ) : channel === "360dialog" ? (
            <Dialog360Connect instanceId={null} connected={false} department="vendas" />
          ) : (
            <MetacloudConnect department="vendas" onConnected={handleConnected} />
          )}
          <button type="button" onClick={onCancel} className="text-xs text-text-muted hover:underline w-fit">
            Cancelar
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 border border-border rounded-lg p-4">
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
        <button type="button" onClick={onCancel} className="text-xs text-text-muted hover:underline w-fit">
          Cancelar
        </button>
      </div>
    );
  }

  // Já existe pelo menos 1 número — número adicional só pode ser API oficial (Meta ou 360dialog;
  // Evolution é fixo, 1 por workspace), num departamento ainda livre.
  return (
    <div className="flex flex-col gap-3 border border-border rounded-lg p-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-bold text-text-muted">Departamento</span>
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary w-fit"
        >
          {availableDepartments.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABEL[d] || d}
            </option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        {(["metacloud", "360dialog"] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`flex-1 text-xs font-bold px-3 py-2 rounded-md border cursor-pointer ${
              channel === c ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
            }`}
          >
            {c === "metacloud" ? "Meta (API oficial)" : "360dialog (API oficial)"}
          </button>
        ))}
      </div>
      {channel === "360dialog" ? (
        <Dialog360Connect instanceId={null} connected={false} department={department} />
      ) : (
        <MetacloudConnect department={department} onConnected={handleConnected} />
      )}
      <button type="button" onClick={onCancel} className="text-xs text-text-muted hover:underline w-fit">
        Cancelar
      </button>
    </div>
  );
}
