"use client";

import { AreaChart, Area, Grid, XAxis, YAxis, ChartTooltip } from "@/components/charts/area-chart";

// Gráfico de mensagens por dia: enviadas (vermelho) e, quando vem, recebidas (ciano) — mesmo par de cores
// do restante dos gráficos.
export function MessagesAreaChart({ data }: { data: { date: string; mensagens: number; recebidas?: number }[] }) {
  const withReceived = data.some((d) => d.recebidas !== undefined);
  return (
    <div>
      <AreaChart data={data} xDataKey="date" aspectRatio="3 / 1" margin={{ top: 20, right: 20, bottom: 36, left: 40 }}>
        <Grid />
        <YAxis numTicks={4} formatValue={(v) => Math.round(v).toLocaleString("pt-BR")} />
        <XAxis numTicks={6} />
        <Area
          dataKey="mensagens"
          fill="var(--chart-line-primary)"
          stroke="var(--chart-line-primary)"
          strokeWidth={2.5}
          fillOpacity={0.16}
        />
        {withReceived && (
          <Area
            dataKey="recebidas"
            fill="var(--chart-line-secondary)"
            stroke="var(--chart-line-secondary)"
            strokeWidth={2.5}
            fillOpacity={0.12}
          />
        )}
        <ChartTooltip
          rows={(p) => [
            { color: "var(--chart-line-primary)", label: "enviadas", value: (p.mensagens as number) ?? 0 },
            ...(withReceived ? [{ color: "var(--chart-line-secondary)", label: "recebidas", value: (p.recebidas as number) ?? 0 }] : []),
          ]}
        />
      </AreaChart>
      {withReceived && (
        <div className="flex gap-4 pl-10 -mt-2">
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--chart-line-primary)" }} /> Enviadas
          </span>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full" style={{ background: "var(--chart-line-secondary)" }} /> Recebidas
          </span>
        </div>
      )}
    </div>
  );
}
