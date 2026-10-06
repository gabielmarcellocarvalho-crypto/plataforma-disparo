"use client";

import Link from "next/link";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SellerTasksConfig } from "@/lib/agent-prompt";
import { HANDOFF_SIGNALS } from "@/lib/agent-handoff";
import { STAGE_LABELS } from "@/lib/crm-stages";
import { cn } from "@/lib/utils";

export type SellerOption = { id: string; name: string; role: string | null };

// Seção "Tarefas na agenda do vendedor" do formulário do agente. Só guarda configuração — quem cria
// a tarefa é createSellerTaskIfNeeded, no turno em que o lead alcança a fase.
export function AgentSellerTasksSection({
  value,
  onChange,
  sellers,
}: {
  value: SellerTasksConfig;
  onChange: (next: SellerTasksConfig) => void;
  sellers: SellerOption[];
}) {
  const selected = new Set(value.memberIds);

  function toggle(id: string) {
    onChange({ ...value, memberIds: selected.has(id) ? value.memberIds.filter((m) => m !== id) : [...value.memberIds, id] });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">Tarefas na agenda do vendedor</span>
        <ToggleSwitch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ ...value, enabled: v })}
          ariaLabel={value.enabled ? "Desativar tarefas na agenda do vendedor" : "Ativar tarefas na agenda do vendedor"}
        />
      </div>
      <p className="text-xs text-text-muted">
        Quando o lead chegar na fase escolhida, o agente cria uma tarefa na <strong className="text-text">Agenda</strong> da
        plataforma com o card do lead, o resumo da conversa e o WhatsApp dele. Vai pro dono do lead se ele estiver na lista
        abaixo; senão, reveza entre os vendedores marcados. Funciona sem Google Agenda e pode ser usado junto com ele.
      </p>

      {value.enabled && (
        <div className="flex flex-col gap-3 mt-1">
          <label className="flex flex-col gap-1.5 sm:max-w-xs">
            <span className="text-xs font-bold text-text-muted">Criar a tarefa quando o lead chegar em</span>
            <select
              value={value.signal}
              onChange={(e) => onChange({ ...value, signal: e.target.value })}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
            >
              {HANDOFF_SIGNALS.map((s) => (
                <option key={s} value={s}>
                  {STAGE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-text-muted">Vendedores que recebem tarefa deste agente</span>
            {sellers.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nenhuma pessoa cadastrada.{" "}
                <Link href="/equipe" className="font-bold text-primary-strong hover:underline">
                  Cadastrar em Equipe
                </Link>
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {sellers.map((s) => {
                  const on = selected.has(s.id);
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        "flex items-center gap-2.5 border rounded-md px-3 py-2 text-sm cursor-pointer transition-colors",
                        on ? "border-primary-strong bg-primary-faint" : "border-border hover:bg-surface-2"
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(s.id)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
                      <span className="font-semibold truncate">{s.name}</span>
                      {s.role && <span className="text-xs text-text-muted truncate">{s.role}</span>}
                    </label>
                  );
                })}
              </div>
            )}
            {sellers.length > 0 && value.memberIds.length === 0 && (
              <p className="text-xs text-warning-text font-semibold">Marque ao menos um vendedor — sem isso nenhuma tarefa é criada.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
