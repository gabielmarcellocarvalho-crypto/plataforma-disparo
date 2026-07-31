"use client";

// Gráfico de rosca simples (SVG puro, sem lib nova) — usado pra "fontes de lead". Poucas categorias
// esperadas (origem é um campo livre), então não precisa da sofisticação do funnel-chart.
import { useState } from "react";

const PALETTE = ["var(--chart-line-primary)", "var(--chart-line-secondary)", "#F59E0B", "#8B5CF6", "#10B981", "#6E6A85"];

export type DonutSlice = { label: string; value: number };

export function DonutChart({ data, size = 168, thickness = 22 }: { data: DonutSlice[]; size?: number; thickness?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;

  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = data.map((d, i) => {
    const frac = d.value / total;
    const dash = frac * circumference;
    const arc = { ...d, i, dashArray: `${dash} ${circumference - dash}`, dashOffset: -offset, color: PALETTE[i % PALETTE.length] };
    offset += dash;
    return arc;
  });

  const activeSlice = hovered !== null ? arcs[hovered] : null;

  return (
    <div className="flex items-center gap-5 flex-wrap">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--chart-grid)" strokeWidth={thickness} />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={thickness}
              strokeDasharray={a.dashArray}
              strokeDashoffset={a.dashOffset}
              opacity={hovered === null || hovered === a.i ? 1 : 0.35}
              onMouseEnter={() => setHovered(a.i)}
              onMouseLeave={() => setHovered(null)}
              className="transition-opacity cursor-pointer"
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center pointer-events-none">
          <div>
            <div className="text-lg font-extrabold tabular-nums leading-none">{activeSlice ? activeSlice.value : total}</div>
            <div className="text-[10px] text-text-muted mt-0.5 max-w-[80px] truncate">{activeSlice ? activeSlice.label : "total"}</div>
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5 min-w-0">
        {arcs.map((a) => (
          <div
            key={a.label}
            onMouseEnter={() => setHovered(a.i)}
            onMouseLeave={() => setHovered(null)}
            className={`flex items-center gap-2 text-xs cursor-pointer transition-opacity ${hovered !== null && hovered !== a.i ? "opacity-40" : ""}`}
          >
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: a.color }} aria-hidden />
            <span className="text-text truncate max-w-[140px]">{a.label}</span>
            <span className="text-text-muted font-mono ml-auto shrink-0">{a.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
