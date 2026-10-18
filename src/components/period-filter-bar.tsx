"use client";

import { useTransition } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";
import { GlassDateRangePicker, formatBr } from "@/components/glass-date-range-picker";
import { AutomaxLoader } from "@/components/page-loading";

export function PeriodFilterBar({ activePreset, from, to, align = "start" }: { activePreset: PeriodPreset; from: string; to: string; align?: "start" | "end" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Trocar só o período não refaz o loading.tsx (a página continua a mesma, só muda a query), então
  // sem isto a tela ficava parada, com os números antigos, até a resposta chegar. Enquanto a navegação
  // está pendente, cobre a área da página com o carregando.
  const [pending, startTransition] = useTransition();

  function applyPreset(preset: PeriodPreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    params.delete("from");
    params.delete("to");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function applyRange(start: string, end: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", start);
    params.set("to", end);
    params.delete("preset");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const activeLabel =
    PERIOD_PRESETS.find((p) => p.key === activePreset)?.label ||
    (activePreset === "custom" ? `${formatBr(from)} – ${formatBr(to)}` : "Período");

  return (
    <>
      <GlassDateRangePicker
        triggerLabel={activeLabel}
        activePreset={activePreset}
        from={from}
        to={to}
        onApplyPreset={applyPreset}
        onApplyRange={applyRange}
        align={align}
      />
      {pending && (
        // Posicionado em relação à raiz da página (que é `relative`): cobre só a área de conteúdo,
        // a sidebar continua livre. O sticky mantém o logo à vista mesmo numa página comprida.
        <div className="absolute inset-0 z-30 bg-bg/70 rounded-xl" aria-live="polite">
          <div className="sticky top-[35vh] flex flex-col items-center gap-3 pt-24">
            <AutomaxLoader />
            <p className="text-sm text-text-muted font-semibold">Carregando…</p>
          </div>
        </div>
      )}
    </>
  );
}
