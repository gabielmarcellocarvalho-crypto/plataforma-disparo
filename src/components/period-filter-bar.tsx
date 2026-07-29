"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/period";
import { GlassDateRangePicker, formatBr } from "@/components/glass-date-range-picker";

export function PeriodFilterBar({ activePreset, from, to }: { activePreset: PeriodPreset; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyPreset(preset: PeriodPreset) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("preset", preset);
    params.delete("from");
    params.delete("to");
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyRange(start: string, end: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", start);
    params.set("to", end);
    params.delete("preset");
    router.push(`${pathname}?${params.toString()}`);
  }

  const activeLabel =
    PERIOD_PRESETS.find((p) => p.key === activePreset)?.label ||
    (activePreset === "custom" ? `${formatBr(from)} – ${formatBr(to)}` : "Período");

  return (
    <GlassDateRangePicker
      triggerLabel={activeLabel}
      activePreset={activePreset}
      from={from}
      to={to}
      onApplyPreset={applyPreset}
      onApplyRange={applyRange}
    />
  );
}
