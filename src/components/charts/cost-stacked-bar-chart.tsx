"use client";

import { useMemo, useState } from "react";
import { ParentSize } from "@visx/responsive";
import { scaleBand, scaleLinear } from "@visx/scale";
import { BarStack } from "@visx/shape";
import { Group } from "@visx/group";
import { GridRows } from "@visx/grid";
import { localPoint } from "@visx/event";

export type CostBarDatum = { date: string; ia: number; entrega: number };

const KEYS = ["ia", "entrega"] as const;
type Key = (typeof KEYS)[number];

const COLORS: Record<Key, string> = {
  ia: "var(--chart-line-primary)", // roxo forte — custo medido de verdade
  entrega: "var(--color-primary-soft)", // roxo suave — estimativa
};
const LABELS: Record<Key, string> = {
  ia: "Custo de IA",
  entrega: "Entrega estimada (API oficial)",
};

function formatDay(iso: string) {
  return String(new Date(iso).getUTCDate());
}

export function CostStackedBarChart({ data }: { data: CostBarDatum[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div style={{ width: "100%", height: 260 }}>
        <ParentSize>{({ width, height }) => (width > 0 ? <Chart width={width} height={height} data={data} /> : null)}</ParentSize>
      </div>
      <div className="flex items-center gap-4">
        {KEYS.map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[k] }} aria-hidden />
            {LABELS[k]}
          </span>
        ))}
      </div>
    </div>
  );
}

function Chart({ width, height, data }: { width: number; height: number; data: CostBarDatum[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; datum: CostBarDatum } | null>(null);
  const margin = { top: 8, right: 8, bottom: 24, left: 48 };
  const xMax = Math.max(0, width - margin.left - margin.right);
  const yMax = Math.max(0, height - margin.top - margin.bottom);

  const maxTotal = useMemo(() => Math.max(1, ...data.map((d) => d.ia + d.entrega)), [data]);
  const xScale = useMemo(() => scaleBand<string>({ domain: data.map((d) => d.date), range: [0, xMax], padding: 0.3 }), [data, xMax]);
  const yScale = useMemo(() => scaleLinear<number>({ domain: [0, maxTotal * 1.15], range: [yMax, 0] }), [maxTotal, yMax]);
  const labelStep = Math.max(1, Math.ceil(data.length / 8));

  if (width < 10) return null;

  return (
    <div className="relative">
      <svg width={width} height={height}>
        <Group left={margin.left} top={margin.top}>
          <GridRows scale={yScale} width={xMax} stroke="var(--chart-grid)" strokeDasharray="2,3" numTicks={4} />
          <BarStack<CostBarDatum, Key> data={data} keys={[...KEYS]} x={(d) => d.date} xScale={xScale} yScale={yScale} value={(d, key) => d[key]} color={(key) => COLORS[key]}>
            {(barStacks) =>
              barStacks.map((barStack) =>
                barStack.bars.map((bar) => (
                  <rect
                    key={`bar-${barStack.index}-${bar.index}`}
                    x={bar.x}
                    y={bar.y}
                    height={Math.max(0, bar.height)}
                    width={bar.width}
                    fill={bar.color}
                    onMouseMove={(event) => {
                      const point = localPoint(event);
                      setTooltip({ x: point?.x ?? 0, y: point?.y ?? 0, datum: data[bar.index] });
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                ))
              )
            }
          </BarStack>
          {yScale.ticks(4).map((t) => (
            <text key={t} x={-8} y={yScale(t)} textAnchor="end" dy="0.32em" fontSize={10} fill="var(--chart-label)">
              R$ {t.toFixed(0)}
            </text>
          ))}
          {data.map((d, i) => {
            if (i % labelStep !== 0) return null;
            const x = (xScale(d.date) ?? 0) + xScale.bandwidth() / 2;
            return (
              <text key={d.date} x={x} y={yMax + 16} textAnchor="middle" fontSize={10} fill="var(--chart-label)">
                {formatDay(d.date)}
              </text>
            );
          })}
        </Group>
      </svg>
      {tooltip && (
        <div
          style={{ position: "absolute", left: Math.min(tooltip.x + 12, width - 160), top: Math.max(tooltip.y - 8, 0) }}
          className="pointer-events-none bg-popover text-popover-foreground text-xs rounded-md shadow-md border border-border px-2.5 py-2 min-w-[140px]"
        >
          <div className="font-bold mb-1">{new Date(tooltip.datum.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-muted"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.ia }} />IA</span>
            <span className="font-semibold">R$ {tooltip.datum.ia.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-text-muted"><span className="w-2 h-2 rounded-full" style={{ background: COLORS.entrega }} />Entrega</span>
            <span className="font-semibold">R$ {tooltip.datum.entrega.toFixed(2)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
