"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { AlertTriangle, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { generateInsights } from "@/app/actions/ai-features";
import type { AiInsight } from "@/lib/ai-insights";

// Insights da IA (Visão geral): gerados sob demanda e guardados no workspace; o botão regenera no
// máximo 1 vez por hora (a action devolve os mesmos enquanto isso).
export function AiInsightsCard({ initial, generatedAt, available }: { initial: AiInsight[]; generatedAt: string | null; available: boolean }) {
  const [insights, setInsights] = useState(initial);
  const [at, setAt] = useState(generatedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      const r = await generateInsights();
      if (r.error !== null) setError(r.error);
      else {
        setInsights(r.data);
        setAt(new Date().toISOString());
      }
    });
  }

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-bold text-[15px] flex items-center gap-1.5">
            <Sparkles size={15} className="text-primary" aria-hidden /> Insights da IA
          </h3>
          <p className="text-xs text-text-muted mt-0.5">
            {at ? `Gerados ${new Date(at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "A partir do funil e das conversas"}
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={pending || !available}
          title={available ? "Gera de novo (no máximo 1 vez por hora)" : "Rode a migração 0089 pra liberar"}
          className="text-xs font-bold px-2.5 py-1.5 rounded-md border border-border hover:bg-surface-2 cursor-pointer disabled:opacity-50 whitespace-nowrap"
        >
          {pending ? "Gerando…" : insights.length ? "Atualizar" : "Gerar"}
        </button>
      </div>

      {insights.length === 0 ? (
        <p className="text-sm text-text-muted py-4 text-center">{available ? "Clique em Gerar pra IA olhar o funil de hoje." : "Disponível depois da migração 0089."}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {insights.map((i, idx) => (
            <li key={idx} className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex items-start gap-2.5">
                <span className={`mt-0.5 ${i.kind === "risco" ? "text-danger" : i.kind === "oportunidade" ? "text-success" : "text-info-text"}`} aria-hidden>
                  {i.kind === "risco" ? <AlertTriangle size={15} /> : i.kind === "oportunidade" ? <TrendingUp size={15} /> : <Lightbulb size={15} />}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold">{i.title}</p>
                  {i.detail && <p className="mt-0.5 text-xs text-text-muted">{i.detail}</p>}
                  {i.href && i.action && (
                    <Link href={i.href} className="mt-1.5 inline-block text-xs font-bold text-primary-strong hover:underline">
                      {i.action} →
                    </Link>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-danger font-medium mt-2">{error}</p>}
    </div>
  );
}
