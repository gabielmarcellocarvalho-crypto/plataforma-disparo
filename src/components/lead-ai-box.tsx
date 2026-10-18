"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import { analyzeLead, updateDealValue } from "@/app/actions/ai-features";
import { TEMPERATURE_UI, type Temperature } from "@/lib/lead-analysis";

type Analysis = { ai_score?: number | null; ai_temperature?: string | null; ai_summary?: string | null; ai_next_action?: string | null; ai_scored_at?: string | null };

// Bloco do painel do lead: resumo da IA (nota, temperatura, próxima ação) com botão pra gerar/atualizar,
// e o valor estimado do negócio.
export function LeadAiBox({
  contactId,
  initial,
  dealValue,
  onPatched,
}: {
  contactId: string;
  initial: Analysis;
  dealValue: number | null;
  onPatched?: (patch: { deal_value?: number | null; ai_score?: number | null; ai_temperature?: string | null }) => void;
}) {
  const [a, setA] = useState<Analysis>(initial);
  const [value, setValue] = useState(dealValue != null ? String(dealValue).replace(".", ",") : "");
  const [error, setError] = useState<string | null>(null);
  const [savedValue, setSavedValue] = useState(false);
  const [pending, startTransition] = useTransition();
  const temp = a.ai_temperature && TEMPERATURE_UI[a.ai_temperature as Temperature];

  function analyze() {
    setError(null);
    startTransition(async () => {
      const r = await analyzeLead(contactId);
      if (r.error !== null) {
        setError(r.error);
        return;
      }
      const next = { ai_score: r.data.score, ai_temperature: r.data.temperature, ai_summary: r.data.summary, ai_next_action: r.data.nextAction, ai_scored_at: new Date().toISOString() };
      setA(next);
      onPatched?.({ ai_score: next.ai_score, ai_temperature: next.ai_temperature });
    });
  }

  function saveValue() {
    setError(null);
    setSavedValue(false);
    const raw = value.trim().replace(/\./g, "").replace(",", ".");
    const n = raw === "" ? null : Number(raw);
    if (n !== null && !Number.isFinite(n)) {
      setError("Valor inválido.");
      return;
    }
    startTransition(async () => {
      const r = await updateDealValue(contactId, n);
      if (r.error !== null) setError(r.error);
      else {
        setSavedValue(true);
        onPatched?.({ deal_value: n });
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg border border-primary-soft bg-primary-faint/60 px-3.5 py-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <span className="flex items-center gap-1.5 text-xs font-bold text-primary-strong">
            <Sparkles size={13} aria-hidden /> Resumo da IA
          </span>
          {temp && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${temp.className}`}>
              {temp.icon} {temp.label}
              {a.ai_score != null ? ` · ${a.ai_score}` : ""}
            </span>
          )}
        </div>
        {a.ai_summary ? (
          <>
            <p className="text-sm">{a.ai_summary}</p>
            {a.ai_next_action && (
              <p className="text-xs mt-1.5">
                <b>Próxima ação sugerida:</b> {a.ai_next_action}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-text-muted">A IA lê a conversa e diz a chance de fechar, um resumo e o que fazer agora.</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-2">
          <button type="button" onClick={analyze} disabled={pending} className="text-xs font-bold px-2.5 py-1 rounded-md bg-primary-strong text-white cursor-pointer disabled:opacity-60">
            {pending ? "Analisando…" : a.ai_summary ? "Atualizar análise" : "Analisar com IA"}
          </button>
          {a.ai_scored_at && (
            <span className="text-[10px] text-text-muted">
              {new Date(a.ai_scored_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1 flex-1">
          <span className="text-xs font-bold">Valor estimado do negócio (R$)</span>
          <input
            value={value}
            onChange={(e) => {
              setValue(e.target.value.replace(/[^\d.,]/g, ""));
              setSavedValue(false);
            }}
            onKeyDown={(e) => e.key === "Enter" && saveValue()}
            inputMode="decimal"
            placeholder="ex.: 1.500"
            className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary bg-surface"
          />
        </label>
        <button type="button" onClick={saveValue} disabled={pending} className="text-xs font-bold px-3 py-2 rounded-md border border-border hover:bg-surface-2 cursor-pointer disabled:opacity-60">
          {savedValue ? "Salvo" : "Salvar"}
        </button>
      </div>
      {error && <p className="text-xs text-danger font-medium">{error}</p>}
    </div>
  );
}
