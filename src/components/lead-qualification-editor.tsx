"use client";

import { useState, useTransition } from "react";
import { saveLeadQualification } from "@/app/actions/api-keys";
import { QUAL_LABELS, QUAL_LEVELS, QUAL_STAGE_OPTIONS, validateQualification, type QualConfig } from "@/lib/lead-qualification";
import type { ContactStage } from "@/lib/crm-stages";

// A partir de qual etapa o lead conta como MQL, SQL e oportunidade (o que a API de leitura e o resumo
// do funil devolvem). Nível que o cliente não usa fica desmarcado e some da API.
export function LeadQualificationEditor({ initial, stageLabels }: { initial: QualConfig; stageLabels: Record<ContactStage, string> }) {
  const [cfg, setCfg] = useState<QualConfig>(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const invalid = validateQualification(cfg);

  function set(level: (typeof QUAL_LEVELS)[number], patch: Partial<QualConfig[(typeof QUAL_LEVELS)[number]]>) {
    setMsg(null);
    setCfg((c) => ({ ...c, [level]: { ...c[level], ...patch } }));
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        Defina a partir de qual etapa do funil o lead vira MQL, SQL e oportunidade. Conta quem está na etapa ou já passou dela. Cliente é
        sempre o lead ganho. Desmarque o nível que vocês não usam.
      </p>
      <div className="border border-border rounded-md divide-y divide-border">
        {QUAL_LEVELS.map((level) => (
          <div key={level} className="flex items-center gap-3 px-3 py-2.5">
            <label className="flex items-center gap-2 w-36 shrink-0 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg[level].enabled}
                onChange={(e) => set(level, { enabled: e.target.checked })}
                className="w-4 h-4 cursor-pointer accent-[var(--color-primary-strong)]"
              />
              <span className="text-sm font-semibold">{QUAL_LABELS[level]}</span>
            </label>
            <select
              value={cfg[level].stage}
              disabled={!cfg[level].enabled}
              onChange={(e) => set(level, { stage: e.target.value as ContactStage })}
              aria-label={`Etapa em que o lead vira ${QUAL_LABELS[level]}`}
              className="flex-1 border border-border rounded-md px-2 py-1.5 text-sm bg-surface outline-none focus:border-primary cursor-pointer disabled:opacity-50"
            >
              {QUAL_STAGE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  a partir de: {stageLabels[s]}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {invalid && <p className="text-xs text-danger font-medium">{invalid}</p>}
      {msg && <p className={`text-xs font-medium ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
      <button
        type="button"
        disabled={pending || Boolean(invalid)}
        onClick={() =>
          startTransition(async () => {
            const r = await saveLeadQualification(cfg);
            setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: "Regras salvas." });
          })
        }
        className="bg-primary-strong text-white text-xs font-bold px-3 py-2 rounded-md w-fit cursor-pointer disabled:opacity-60"
      >
        {pending ? "Salvando…" : "Salvar regras"}
      </button>
    </div>
  );
}
