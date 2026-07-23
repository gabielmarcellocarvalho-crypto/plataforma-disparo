"use client";

import { AreaChart, Area, Grid, XAxis, YAxis, ChartTooltip } from "@/components/charts/area-chart";

// Gráfico de mensagens por dia — uma linha só (mensagens), roxo.
export function MessagesAreaChart({ data }: { data: { date: string; mensagens: number }[] }) {
  return (
    <AreaChart data={data} xDataKey="date" aspectRatio="3 / 1" margin={{ top: 20, right: 20, bottom: 36, left: 40 }}>
      <Grid />
      <YAxis numTicks={4} />
      <XAxis numTicks={6} />
      <Area
        dataKey="mensagens"
        fill="var(--chart-line-primary)"
        stroke="var(--chart-line-primary)"
        strokeWidth={2.5}
        fillOpacity={0.16}
      />
      <ChartTooltip
        rows={(p) => [{ color: "var(--chart-line-primary)", label: "mensagens", value: (p.mensagens as number) ?? 0 }]}
      />
    </AreaChart>
  );
}
