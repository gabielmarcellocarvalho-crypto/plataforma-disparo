"use client";

import Link from "next/link";
import { ToggleSwitch } from "@/components/toggle-switch";
import { GoogleLogo } from "@/components/google-logo";
import type { SchedulingConfig } from "@/lib/agent-prompt";
import { cn } from "@/lib/utils";

export type SchedulingCloserOption = {
  id: string;
  name: string;
  role: string | null;
  status: "conectado" | "reconectar" | "desconectado";
};

// Seção "Agendamento de reunião" do formulário do agente. Só guarda configuração — quem decide se o
// agente de fato recebe as ferramentas de agenda num turno é getSchedulingContext (precisa de closer
// conectado). Duração e horários não ficam aqui: vêm dos eventos "Marque aqui" de cada closer.
export function AgentSchedulingSection({
  value,
  onChange,
  closers,
}: {
  value: SchedulingConfig;
  onChange: (next: SchedulingConfig) => void;
  closers: SchedulingCloserOption[];
}) {
  const selected = new Set(value.closerIds);
  const selectedConnected = closers.filter((c) => selected.has(c.id) && c.status === "conectado").length;

  function toggleCloser(id: string) {
    const next = selected.has(id) ? value.closerIds.filter((c) => c !== id) : [...value.closerIds, id];
    onChange({ ...value, closerIds: next });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold inline-flex items-center gap-2">
          <GoogleLogo size={14} />
          Agendamento de reunião
        </span>
        <ToggleSwitch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ ...value, enabled: v })}
          ariaLabel={value.enabled ? "Desativar agendamento de reunião" : "Ativar agendamento de reunião"}
        />
      </div>
      <p className="text-xs text-text-muted">
        Quando o lead estiver qualificado, o agente oferece horários e marca uma reunião no Google Meet direto na agenda do
        closer, usando os eventos <strong className="text-text">{value.slotTitle}</strong> que ele cria. Vai pro dono do lead
        se ele estiver na lista abaixo; senão, reveza entre os closers. Sem nenhum closer com agenda conectada, o agente
        segue como hoje e sinaliza pra um humano.
      </p>

      {value.enabled && (
        <div className="flex flex-col gap-3 mt-1">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-text-muted">Closers que recebem reunião deste agente</span>
            {closers.length === 0 ? (
              <p className="text-xs text-text-muted">
                Nenhuma pessoa cadastrada.{" "}
                <Link href="/equipe" className="font-bold text-primary-strong hover:underline">
                  Cadastrar em Equipe
                </Link>
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {closers.map((c) => {
                  const on = selected.has(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex items-center gap-2.5 border rounded-md px-3 py-2 text-sm cursor-pointer transition-colors",
                        on ? "border-primary-strong bg-primary-faint" : "border-border hover:bg-surface-2"
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggleCloser(c.id)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
                      <span className="font-semibold truncate">{c.name}</span>
                      {c.role && <span className="text-xs text-text-muted truncate">{c.role}</span>}
                      <span
                        className={cn(
                          "ml-auto shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full",
                          c.status === "conectado" && "bg-success-soft text-success",
                          c.status === "reconectar" && "bg-warning-soft text-warning-text",
                          c.status === "desconectado" && "bg-surface-2 border border-border text-text-muted"
                        )}
                      >
                        {c.status === "conectado" ? "agenda conectada" : c.status === "reconectar" ? "reconectar" : "sem agenda"}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {value.closerIds.length > 0 && selectedConnected === 0 && (
              <p className="text-xs text-warning-text font-semibold">
                Nenhum dos closers escolhidos tem agenda conectada — o agente não vai marcar reunião até alguém conectar em{" "}
                <Link href="/integracoes" className="underline">
                  Integrações
                </Link>
                .
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Título do evento de horário livre</span>
              <input
                value={value.slotTitle}
                onChange={(e) => onChange({ ...value, slotTitle: e.target.value })}
                onBlur={(e) => !e.target.value.trim() && onChange({ ...value, slotTitle: "Marque aqui" })}
                maxLength={60}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Antecedência mínima (horas)</span>
              <input
                type="number"
                min={0}
                max={72}
                value={value.minNoticeHours}
                onChange={(e) => onChange({ ...value, minNoticeHours: Math.max(0, Math.min(72, Number(e.target.value) || 0)) })}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">Oferecer até quantos dias à frente</span>
              <input
                type="number"
                min={1}
                max={30}
                value={value.daysAhead}
                onChange={(e) => onChange({ ...value, daysAhead: Math.max(1, Math.min(30, Number(e.target.value) || 1)) })}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
