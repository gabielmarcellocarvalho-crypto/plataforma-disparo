"use client";

import Link from "next/link";
import { ToggleSwitch } from "@/components/toggle-switch";

export type IntegrationOption = {
  provider: string;
  label: string;
  status: "conectado" | "reconectar";
  // Só as permissões que o workspace liberou em Integrações (e que estão disponíveis).
  capabilities: { id: string; label: string; agentNote: string }[];
};

// Aba "Integrações" do agente. Só guarda configuração: quem decide se o agente de fato recebe as
// ferramentas num turno é getNuvemshopContext (precisa da integração conectada no workspace).
export function AgentIntegrationsSection({
  value,
  onChange,
  options,
}: {
  value: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  options: IntegrationOption[];
}) {
  if (options.length === 0) {
    return (
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <span className="text-sm font-bold">Integrações</span>
        <p className="text-xs text-text-muted">
          Nenhuma integração conectada neste workspace.{" "}
          <Link href="/integracoes" className="font-bold text-primary-strong hover:underline">
            Conectar em Integrações
          </Link>
        </p>
      </div>
    );
  }

  function toggle(provider: string, id: string, on: boolean) {
    const current = value[provider] ?? [];
    const next = on ? [...new Set([...current, id])] : current.filter((c) => c !== id);
    onChange({ ...value, [provider]: next });
  }

  return (
    <div className="flex flex-col gap-5">
      {options.map((opt) => {
        const active = new Set(value[opt.provider] ?? []);
        return (
          <div key={opt.provider} className="flex flex-col gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-bold">{opt.label}</span>
              <Link href={`/integracoes/${opt.provider}`} className="text-xs font-bold text-primary-strong hover:underline">
                Gerenciar conexão
              </Link>
            </div>
            {opt.status === "reconectar" && (
              <p className="text-xs text-warning-text">
                A conexão com {opt.label} precisa ser refeita. Enquanto isso o agente não usa essa integração.
              </p>
            )}
            {opt.capabilities.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nenhuma permissão liberada em Integrações. Libere lá o que este agente poderá usar.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {opt.capabilities.map((c) => {
                  const on = active.has(c.id);
                  return (
                    <li key={c.id} className="flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold">{c.label}</span>
                        <ToggleSwitch
                          checked={on}
                          onCheckedChange={(v) => toggle(opt.provider, c.id, v)}
                          ariaLabel={`${on ? "Desativar" : "Ativar"} ${c.label} neste agente`}
                        />
                      </div>
                      <p className={on ? "text-xs text-text" : "text-xs text-text-muted"}>{c.agentNote}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
