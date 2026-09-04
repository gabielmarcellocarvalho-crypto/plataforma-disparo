"use client";

// Funil de conversão — segmentos que estreitam (curva) com animação de entrada e destaque no hover.
// Adaptado de uma referência genérica (biblioteca "motion", já usada em area-chart.tsx) pro estilo
// visual do resto do projeto: tokens de cor do tema (--chart-line-primary etc.) em vez de tokens
// shadcn, e bem mais enxuto — só o que a Visão geral precisa (horizontal, sem gradiente/pattern por
// estágio, sem grid liga/desliga configurável).
import { motion, useSpring, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

// `value` desenha o funil (cumulativo). `currentLabel`, quando vem, aparece como uma linha extra
// abaixo do rótulo — é o "quantos estão nessa fase agora", que reconcilia o funil com o Kanban.
export type FunnelStage = { label: string; value: number; displayValue?: string; currentLabel?: string };

const growSpring = { stiffness: 120, damping: 20, mass: 1 };
const hoverSpring = { stiffness: 300, damping: 24 };

function segmentPath(normStart: number, normEnd: number, segW: number, H: number, layerScale: number) {
  const my = H / 2;
  const h0 = normStart * H * 0.42 * layerScale;
  const h1 = normEnd * H * 0.42 * layerScale;
  const cx = segW * 0.55;
  const top = `M 0 ${my - h0} C ${cx} ${my - h0}, ${segW - cx} ${my - h1}, ${segW} ${my - h1}`;
  const bot = `L ${segW} ${my + h1} C ${segW - cx} ${my + h1}, ${cx} ${my + h0}, 0 ${my + h0}`;
  return `${top} ${bot} Z`;
}

function Ring({ d, opacity, hovered, ringIndex, totalRings }: { d: string; opacity: number; hovered: boolean; ringIndex: number; totalRings: number }) {
  const extraScale = 1 + (ringIndex / Math.max(totalRings - 1, 1)) * 0.12;
  const ringSpring = { stiffness: 300 - ringIndex * 60, damping: 24 - ringIndex * 3 };
  const scaleY = useSpring(1, ringSpring);
  useEffect(() => {
    scaleY.set(hovered ? extraScale : 1);
  }, [hovered, scaleY, extraScale]);
  return <motion.path d={d} fill="var(--chart-line-primary)" opacity={opacity} style={{ scaleY, transformOrigin: "center center" }} />;
}

function Segment({
  index,
  normStart,
  normEnd,
  segW,
  fullH,
  layers,
  staggerDelay,
  hovered,
  dimmed,
}: {
  index: number;
  normStart: number;
  normEnd: number;
  segW: number;
  fullH: number;
  layers: number;
  staggerDelay: number;
  hovered: boolean;
  dimmed: boolean;
}) {
  const growProgress = useSpring(0, growSpring);
  const entranceScale = useTransform(growProgress, [0, 1], [0, 1]);
  const dimOpacity = useSpring(1, hoverSpring);

  useEffect(() => {
    dimOpacity.set(dimmed ? 0.35 : 1);
  }, [dimmed, dimOpacity]);

  useEffect(() => {
    const t = setTimeout(() => growProgress.set(1), index * staggerDelay * 1000);
    return () => clearTimeout(t);
  }, [growProgress, index, staggerDelay]);

  const rings = Array.from({ length: layers }, (_, l) => {
    const scale = 1 - (l / layers) * 0.35;
    const opacity = 0.16 + (l / (layers - 1 || 1)) * 0.6;
    return { d: segmentPath(normStart, normEnd, segW, fullH, scale), opacity };
  });

  return (
    <motion.div
      className="pointer-events-none relative shrink-0 overflow-visible"
      style={{ width: segW, height: fullH, zIndex: hovered ? 10 : 1, opacity: dimOpacity }}
    >
      <motion.div
        className="absolute inset-0 overflow-visible"
        style={{ scaleX: entranceScale, scaleY: entranceScale, transformOrigin: "left center" }}
      >
        <svg aria-hidden className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox={`0 0 ${segW} ${fullH}`}>
          {rings.map((r, i) => (
            <Ring key={i} d={r.d} opacity={r.opacity} hovered={hovered} ringIndex={i} totalRings={layers} />
          ))}
        </svg>
      </motion.div>
    </motion.div>
  );
}

export function FunnelChart({
  data,
  layers = 3,
  staggerDelay = 0.12,
  gap = 6,
  className,
}: {
  data: FunnelStage[];
  layers?: number;
  staggerDelay?: number;
  gap?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sz, setSz] = useState({ w: 0, h: 0 });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const measure = useCallback(() => {
    if (!ref.current) return;
    const { width: w, height: h } = ref.current.getBoundingClientRect();
    if (w > 0 && h > 0) setSz({ w, h });
  }, []);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [measure]);

  if (!data.length) return null;
  const max = Math.max(1, ...data.map((d) => d.value));
  const n = data.length;
  const norms = data.map((d) => d.value / max);
  const { w: W, h: H } = sz;
  const totalGap = gap * (n - 1);
  const segW = (W - totalGap) / n;

  return (
    <div className={`relative w-full select-none overflow-visible ${className ?? ""}`} ref={ref} style={{ aspectRatio: "3.2 / 1" }}>
      {W > 0 && H > 0 && (
        <>
          <div className="absolute inset-0 flex flex-row overflow-visible" style={{ gap }}>
            {data.map((stage, i) => (
              <Segment
                key={stage.label}
                index={i}
                normStart={norms[i] ?? 0}
                normEnd={norms[Math.min(i + 1, n - 1)] ?? 0}
                segW={segW}
                fullH={H}
                layers={layers}
                staggerDelay={staggerDelay}
                hovered={hoveredIndex === i}
                dimmed={hoveredIndex !== null && hoveredIndex !== i}
              />
            ))}
          </div>

          {data.map((stage, i) => {
            const pctOfFirst = data[0]?.value ? (stage.value / data[0].value) * 100 : 0;
            const isDimmed = hoveredIndex !== null && hoveredIndex !== i;
            return (
              <motion.div
                key={`lbl-${stage.label}`}
                className="absolute cursor-pointer flex flex-col items-center justify-center gap-1"
                style={{ left: (segW + gap) * i, width: segW, top: 0, height: H, zIndex: 20 }}
                animate={{ opacity: isDimmed ? 0.45 : 1 }}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                <span className="text-sm font-extrabold text-text tabular-nums">{stage.displayValue ?? stage.value.toLocaleString("pt-BR")}</span>
                <span className="rounded-full bg-primary-strong px-2.5 py-0.5 text-[11px] font-bold text-white shadow-sm tabular-nums">
                  {Math.round(pctOfFirst)}%
                </span>
                <span className="text-[11px] font-semibold text-text-muted text-center px-1 leading-tight">{stage.label}</span>
                {stage.currentLabel && (
                  <span className="text-[10px] font-medium text-text-muted/75 text-center px-1 leading-tight tabular-nums">{stage.currentLabel}</span>
                )}
              </motion.div>
            );
          })}
        </>
      )}
    </div>
  );
}

FunnelChart.displayName = "FunnelChart";
