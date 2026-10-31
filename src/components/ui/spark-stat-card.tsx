"use client";

// Card de indicador com mini gráfico de área (estilo "area-charts-1" que o dono mandou de referência),
// feito em SVG puro com os tokens do AutomaX — sem recharts/shadcn, que o projeto não usa. A cor vem do
// chamador (var(--color-…)), então cada indicador mantém a paleta do sistema e do workspace.
import { useId, useState, type ReactNode } from "react";

export type SparkPoint = { label: string; value: number };

const W = 160;
const H = 56;
const PAD = 4;

// Curva suave passando pelos pontos (pontos médios + quadrática), sem estourar acima/abaixo dos dados.
function smooth(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M ${pts[0][0]} ${pts[0][1]}`;
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q ${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} T ${last[0].toFixed(1)} ${last[1].toFixed(1)}`;
}

export function Delta({ value }: { value?: number | null }) {
  if (value === null || value === undefined) return null;
  const up = value > 0;
  const flat = value === 0;
  return (
    <span
      className={`text-[11px] font-bold ${flat ? "text-text-muted" : up ? "text-success" : "text-danger"}`}
      title="Comparado com o período anterior de mesma duração"
    >
      {flat ? "=" : up ? "▲" : "▼"} {Math.abs(value)}%
    </span>
  );
}

export function SparkStatCard({
  title,
  icon,
  value,
  caption,
  delta,
  series,
  color = "var(--color-primary)",
  unit = "",
}: {
  title: string;
  icon: ReactNode;
  value: string | number;
  caption: string;
  delta?: number | null;
  series: SparkPoint[];
  color?: string;
  unit?: string;
}) {
  const gid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);

  const max = Math.max(...series.map((p) => p.value), 1);
  const step = series.length > 1 ? (W - PAD * 2) / (series.length - 1) : 0;
  const pts: [number, number][] = series.map((p, i) => [PAD + i * step, H - PAD - (p.value / max) * (H - PAD * 2)]);
  const line = smooth(pts);
  const area = pts.length > 1 ? `${line} L ${pts[pts.length - 1][0].toFixed(1)} ${H} L ${pts[0][0].toFixed(1)} ${H} Z` : "";
  const active = hover !== null ? series[hover] : null;

  return (
    <article className="bg-surface border border-border rounded-lg shadow-sm p-4 min-w-0">
      <div className="flex items-center gap-2">
        <span className="shrink-0" style={{ color }} aria-hidden>
          {icon}
        </span>
        <h3 className="text-sm font-semibold truncate">{title}</h3>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-text-muted truncate capitalize">{caption}</p>
          <div className="mt-1 flex items-baseline gap-2">
            <b className="text-[26px] font-extrabold tracking-tight leading-none tabular-nums">{value}</b>
            <Delta value={delta} />
          </div>
        </div>
        <div
          className="relative h-14 w-full max-w-[150px]"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            if (series.length < 2) return;
            const r = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(series.length - 1, Math.round((x - PAD) / (step || 1)))));
          }}
        >
          {series.length > 1 && (
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" aria-hidden>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.04} />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gid})`} />
              <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              {hover !== null && <line x1={pts[hover][0]} x2={pts[hover][0]} y1={0} y2={H} stroke={color} strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />}
            </svg>
          )}
          {hover !== null && series.length > 1 && (
            <span
              className="pointer-events-none absolute size-2.5 rounded-full border-2 border-white shadow"
              style={{ background: color, left: `calc(${(pts[hover][0] / W) * 100}% - 5px)`, top: `calc(${(pts[hover][1] / H) * 100}% - 5px)` }}
            />
          )}
          {active && (
            <div className="pointer-events-none absolute -top-9 right-0 z-10 whitespace-nowrap rounded-md border border-border bg-surface px-2 py-1 text-[11px] shadow-lg">
              <span className="text-text-muted">{active.label}: </span>
              <b className="tabular-nums">
                {active.value.toLocaleString("pt-BR")}
                {unit}
              </b>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
