"use client";

import Link from "next/link";
import { ToggleSwitch } from "@/components/toggle-switch";
import type { SellerPhaseConfig, SellerTasksConfig } from "@/lib/agent-prompt";
import { HANDOFF_SIGNALS } from "@/lib/agent-handoff";
import { STAGE_LABELS, type ContactStage } from "@/lib/crm-stages";
import { cn } from "@/lib/utils";

export type TriggerOption = { signal: ContactStage; label: string };

export type SellerOption = { id: string; name: string; role: string | null };

// Seção "Tarefas na agenda do vendedor" do formulário do agente. Só guarda configuração — quem cria
// a tarefa é createSellerTaskIfNeeded, no turno em que o lead alcança a fase.
export function AgentSellerTasksSection({
  value,
  onChange,
  sellers,
  triggerOptions,
}: {
  value: SellerTasksConfig;
  onChange: (next: SellerTasksConfig) => void;
  sellers: SellerOption[];
  triggerOptions?: TriggerOption[];
}) {
  // Etapas do funil do workspace; sem elas cai nas fases fixas. Se o valor salvo não está na lista
  // (etapa removida do funil depois), ele aparece mesmo assim pra não trocar a configuração calado.
  const base = triggerOptions && triggerOptions.length > 0 ? triggerOptions : HANDOFF_SIGNALS.map((s) => ({ signal: s, label: STAGE_LABELS[s] }));
  const options = base.some((o) => o.signal === value.signal)
    ? base
    : [...base, { signal: value.signal as ContactStage, label: STAGE_LABELS[value.signal as ContactStage] ?? value.signal }];
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
              {options.map((o) => (
                <option key={o.signal} value={o.signal}>
                  {o.label}
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

// Etapa que aparece na lista da fase do vendedor. `id` null = workspace sem funil (vale o sinal).
export type PhaseStageOption = { id: string | null; pipeline: string | null; name: string; signal: ContactStage };

// Seção "Fase do vendedor": nas etapas marcadas a IA para de responder o lead. Só guarda configuração —
// a trava fica em inSellerPhase (seller-phase.ts), checada em toda mensagem.
export function AgentSellerPhaseSection({
  value,
  onChange,
  stageOptions,
}: {
  value: SellerPhaseConfig;
  onChange: (next: SellerPhaseConfig) => void;
  stageOptions: PhaseStageOption[];
}) {
  const keyOf = (o: PhaseStageOption) => o.id ?? `sinal:${o.signal}`;
  const isOn = (o: PhaseStageOption) => (o.id ? value.stageIds.includes(o.id) : value.signals.includes(o.signal));

  // Com funil, o que manda são as etapas; os sinais delas vão junto pro lead que ainda não tem etapa.
  function toggle(o: PhaseStageOption) {
    if (!o.id) {
      const signals = isOn(o) ? value.signals.filter((s) => s !== o.signal) : [...value.signals, o.signal];
      onChange({ ...value, signals });
      return;
    }
    const stageIds = isOn(o) ? value.stageIds.filter((id) => id !== o.id) : [...value.stageIds, o.id];
    const signals = [...new Set(stageOptions.filter((x) => x.id && stageIds.includes(x.id)).map((x) => x.signal))];
    onChange({ ...value, stageIds, signals });
  }

  const groups = new Map<string, PhaseStageOption[]>();
  for (const o of stageOptions) groups.set(o.pipeline ?? "", [...(groups.get(o.pipeline ?? "") ?? []), o]);
  const anyOn = stageOptions.some(isOn);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-bold">Fase do vendedor (IA para de responder)</span>
        <ToggleSwitch
          checked={value.enabled}
          onCheckedChange={(v) => onChange({ ...value, enabled: v })}
          ariaLabel={value.enabled ? "Desativar fase do vendedor" : "Ativar fase do vendedor"}
        />
      </div>
      <p className="text-xs text-text-muted">
        Nas etapas marcadas a IA não responde o lead: a conversa vai pra fila de <strong className="text-text">atenção</strong> em
        Conversas e o vendedor segue pelo painel ou pelo celular. Vale também pro lead que você arrastar pra essas etapas no
        CRM. Pra IA voltar, é só mover o lead pra uma etapa não marcada.
      </p>

      {value.enabled && (
        <div className="flex flex-col gap-3 mt-1">
          {[...groups.entries()].map(([pipeline, opts]) => (
            <div key={pipeline || "-"} className="flex flex-col gap-1.5">
              <span className="text-xs font-bold text-text-muted">{pipeline ? `Funil ${pipeline}` : "Etapas em que a IA não responde"}</span>
              <div className="flex flex-col gap-1.5">
                {opts.map((o) => {
                  const on = isOn(o);
                  return (
                    <label
                      key={keyOf(o)}
                      className={cn(
                        "flex items-center gap-2.5 border rounded-md px-3 py-2 text-sm cursor-pointer transition-colors",
                        on ? "border-primary-strong bg-primary-faint" : "border-border hover:bg-surface-2"
                      )}
                    >
                      <input type="checkbox" checked={on} onChange={() => toggle(o)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
                      <span className="font-semibold truncate">{o.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          {!anyOn && <p className="text-xs text-warning-text font-semibold">Marque ao menos uma etapa — sem isso a IA responde em todas.</p>}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-text-muted">Última mensagem da IA ao passar pro vendedor (opcional)</span>
            <textarea
              value={value.farewell}
              onChange={(e) => onChange({ ...value, farewell: e.target.value })}
              rows={2}
              maxLength={500}
              placeholder="Ex: Perfeito! Vou te passar pro nosso consultor, ele já te chama por aqui."
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y"
            />
          </label>
        </div>
      )}
    </div>
  );
}
