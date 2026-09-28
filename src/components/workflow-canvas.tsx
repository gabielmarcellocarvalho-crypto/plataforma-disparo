"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LayoutGrid, Maximize2, Minus, Plus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Canvas do editor de workflow, no molde n8n/Make: nós arrastáveis ligados SEMPRE por linha
// pontilhada porta-a-porta, "+" fantasma no fim do fluxo e de cada ramo, zoom e arrastar o fundo pra
// mover a tela. Só apresentação — quem decide a estrutura (ordem, ramos) é o WorkflowBuilder; arrastar
// muda só a posição visual, nunca a ordem de execução.
//
// A posição de cada nó é ESTADO (layout calculado + deslocamento do usuário) e as linhas são
// desenhadas a partir dela. Antes o deslocamento ficava só no card e a linha continuava na posição
// antiga — arrastar um nó deixava ele "desconectado" na tela.

export const NODE_W = 216;
export const NODE_H = 88;

export type NodeKind = "trigger" | "audience" | "action" | "wait" | "condition";

export type CanvasNodeSpec = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  active: boolean;
  onSelect: () => void;
};

// `port`: de qual saída a linha parte. "yes"/"no" são as duas saídas da condição.
export type CanvasEdgeSpec = { from: string; to: string; port?: "out" | "yes" | "no" };

export type AddOption = { key: string; label: string; icon: LucideIcon; onPick: () => void };

// Nó fantasma "+" ligado ao último nó de uma trilha (fluxo principal ou ramo).
export type CanvasAddSlot = { id: string; after: string; port?: "out" | "yes" | "no"; x: number; y: number; label: string; options: AddOption[] };

const KIND_UI: Record<NodeKind, { badge: string; ring: string; icon: string; port: string }> = {
  trigger: { badge: "Gatilho", ring: "border-success/40", icon: "bg-success-soft text-success border-success/30", port: "bg-success" },
  audience: { badge: "Público", ring: "border-info-text/30", icon: "bg-info-soft text-info-text border-info-text/30", port: "bg-info-text" },
  action: { badge: "Ação", ring: "border-primary-strong/30", icon: "bg-primary-soft text-primary-strong border-primary-strong/30", port: "bg-primary-strong" },
  wait: { badge: "Espera", ring: "border-border-strong", icon: "bg-surface-2 text-text-muted border-border-strong", port: "bg-text-muted" },
  condition: { badge: "Condição", ring: "border-warning-text/30", icon: "bg-warning-soft text-warning-text border-warning-text/30", port: "bg-warning-text" },
};

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 1.6;
const PAD = 48;

type Point = { x: number; y: number };

function outPort(n: Point, port: "out" | "yes" | "no" = "out"): Point {
  const dy = port === "yes" ? NODE_H * 0.3 : port === "no" ? NODE_H * 0.7 : NODE_H / 2;
  return { x: n.x + NODE_W, y: n.y + dy };
}
function inPort(n: Point, h = NODE_H): Point {
  return { x: n.x, y: n.y + h / 2 };
}
function bezier(a: Point, b: Point) {
  const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
}

const ADD_W = 132;
const ADD_H = 44;

export function WorkflowCanvas({
  nodes,
  edges,
  addSlots,
  layoutKey,
}: {
  nodes: CanvasNodeSpec[];
  edges: CanvasEdgeSpec[];
  addSlots: CanvasAddSlot[];
  // Muda quando a ESTRUTURA muda (passo adicionado/removido/movido) — aí o layout automático volta a
  // valer, senão um deslocamento antigo ficaria preso ao id de um passo que agora é outro.
  layoutKey: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [offsets, setOffsets] = useState<Record<string, Point>>({});
  const [zoom, setZoom] = useState(1);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const drag = useRef<{ id: string; start: Point; origin: Point; moved: boolean } | null>(null);
  const pan = useRef<{ start: Point; scroll: Point } | null>(null);

  useEffect(() => setOffsets({}), [layoutKey]);

  // Posição efetiva = layout + deslocamento do usuário. Linhas, portas e "+" saem daqui.
  const pos = useMemo(() => {
    const map = new Map<string, Point>();
    for (const n of nodes) map.set(n.id, { x: n.x + (offsets[n.id]?.x || 0), y: n.y + (offsets[n.id]?.y || 0) });
    for (const s of addSlots) map.set(s.id, { x: s.x + (offsets[s.id]?.x || 0), y: s.y + (offsets[s.id]?.y || 0) });
    return map;
  }, [nodes, addSlots, offsets]);

  const size = useMemo(() => {
    let w = 0;
    let h = 0;
    for (const p of pos.values()) {
      w = Math.max(w, p.x + NODE_W);
      h = Math.max(h, p.y + NODE_H);
    }
    return { w: w + PAD * 2, h: h + PAD * 2 };
  }, [pos]);

  // ── Arrastar nó (pointer events próprios: funciona com zoom e separa clique de arrasto) ──
  function onNodePointerDown(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id, start: { x: e.clientX, y: e.clientY }, origin: offsets[id] || { x: 0, y: 0 }, moved: false };
  }
  function onNodePointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = (e.clientX - d.start.x) / zoom;
    const dy = (e.clientY - d.start.y) / zoom;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    setOffsets((prev) => ({ ...prev, [d.id]: { x: d.origin.x + dx, y: d.origin.y + dy } }));
  }
  function onNodePointerUp(onClick: () => void) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) onClick();
  }

  // ── Arrastar o fundo = mover a tela ──
  function onBgPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !scrollRef.current) return;
    setOpenMenu(null);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pan.current = { start: { x: e.clientX, y: e.clientY }, scroll: { x: scrollRef.current.scrollLeft, y: scrollRef.current.scrollTop } };
  }
  function onBgPointerMove(e: React.PointerEvent) {
    const p = pan.current;
    if (!p || !scrollRef.current) return;
    scrollRef.current.scrollLeft = p.scroll.x - (e.clientX - p.start.x);
    scrollRef.current.scrollTop = p.scroll.y - (e.clientY - p.start.y);
  }

  function clampZoom(z: number) {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));
  }
  function fit() {
    const el = scrollRef.current;
    if (!el) return;
    setZoom(clampZoom(Math.min(1, (el.clientWidth - 24) / size.w, (el.clientHeight - 24) / size.h)));
    el.scrollTo({ left: 0, top: 0 });
  }
  // Ctrl + roda do mouse = zoom (igual n8n); roda sozinha continua rolando.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom((z) => clampZoom(z - e.deltaY * 0.0015));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const connectionCount = edges.length + addSlots.length;

  return (
    <div className="relative flex flex-col h-full min-h-0">
      <style>{`
        @keyframes wf-dash { to { stroke-dashoffset: -24; } }
        .wf-edge { animation: wf-dash 1.2s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .wf-edge { animation: none; } }
      `}</style>

      <div
        ref={scrollRef}
        className="relative flex-1 min-h-0 overflow-auto bg-bg cursor-grab active:cursor-grabbing"
        style={{
          // Quadriculado de pontos no próprio container (rola junto e acompanha o zoom) — um fundo
          // gigante dentro do conteúdo faria a barra de rolagem ir muito além do fluxo.
          backgroundImage: "radial-gradient(circle, var(--color-border-strong) 1.1px, transparent 1.2px)",
          backgroundSize: `${22 * zoom}px ${22 * zoom}px`,
          backgroundAttachment: "local",
        }}
        onPointerDown={onBgPointerDown}
        onPointerMove={onBgPointerMove}
        onPointerUp={() => (pan.current = null)}
        role="region"
        aria-label="Canvas do workflow"
      >
        <div style={{ width: size.w * zoom, height: size.h * zoom }} className="relative">
          <div className="absolute top-0 left-0 origin-top-left" style={{ width: size.w, height: size.h, transform: `scale(${zoom})` }}>
            <div className="absolute" style={{ left: PAD, top: PAD }}>
              <svg className="absolute top-0 left-0 overflow-visible pointer-events-none" width={size.w} height={size.h} aria-hidden>
                <defs>
                  <marker id="wf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" className="fill-text-muted" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = pos.get(e.from);
                  const b = pos.get(e.to);
                  if (!a || !b) return null;
                  return (
                    <path
                      key={`${e.from}-${e.to}`}
                      d={bezier(outPort(a, e.port), inPort(b))}
                      fill="none"
                      strokeWidth={2}
                      strokeDasharray="6 6"
                      strokeLinecap="round"
                      markerEnd="url(#wf-arrow)"
                      className={cn("wf-edge", e.port === "yes" ? "stroke-success" : e.port === "no" ? "stroke-danger" : "stroke-text-muted")}
                      opacity={0.7}
                    />
                  );
                })}
                {addSlots.map((s) => {
                  const a = pos.get(s.after);
                  const b = pos.get(s.id);
                  if (!a || !b) return null;
                  return (
                    <path
                      key={s.id}
                      d={bezier(outPort(a, s.port), inPort(b, ADD_H))}
                      fill="none"
                      strokeWidth={2}
                      strokeDasharray="4 6"
                      strokeLinecap="round"
                      className="stroke-border-strong"
                    />
                  );
                })}
              </svg>

              {/* Selos SIM/NÃO no meio das linhas que saem da condição */}
              {[...edges.filter((e) => e.port === "yes" || e.port === "no"), ...addSlots.filter((s) => s.port === "yes" || s.port === "no").map((s) => ({ from: s.after, to: s.id, port: s.port }))].map((e) => {
                const a = pos.get(e.from);
                const b = pos.get(e.to);
                if (!a || !b) return null;
                const s = outPort(a, e.port);
                const t = inPort(b, e.to.startsWith("add-") ? ADD_H : NODE_H);
                return (
                  <span
                    key={`lbl-${e.from}-${e.to}`}
                    className={cn(
                      "absolute -translate-x-1/2 -translate-y-1/2 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border pointer-events-none",
                      e.port === "yes" ? "bg-success-soft text-success border-success/30" : "bg-danger-soft text-danger border-danger/30"
                    )}
                    style={{ left: (s.x + t.x) / 2, top: (s.y + t.y) / 2 }}
                  >
                    {e.port === "yes" ? "SIM" : "NÃO"}
                  </span>
                );
              })}

              {nodes.map((n) => {
                const p = pos.get(n.id)!;
                const ui = KIND_UI[n.kind];
                const Icon = n.icon;
                return (
                  <div
                    key={n.id}
                    role="button"
                    tabIndex={0}
                    aria-pressed={n.active}
                    aria-label={`${ui.badge}: ${n.title}`}
                    onPointerDown={(e) => onNodePointerDown(e, n.id)}
                    onPointerMove={onNodePointerMove}
                    onPointerUp={() => onNodePointerUp(n.onSelect)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), n.onSelect())}
                    className={cn(
                      "absolute group select-none touch-none rounded-xl border-2 bg-surface px-3 py-2.5 cursor-pointer transition-shadow",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      ui.ring,
                      n.active ? "shadow-lg ring-2 ring-primary/60" : "shadow-sm hover:shadow-md"
                    )}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                  >
                    {/* Portas: entrada à esquerda (menos no gatilho), saída à direita (duas na condição) */}
                    {n.kind !== "trigger" && (
                      <span className={cn("absolute -left-[6px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-surface", ui.port)} aria-hidden />
                    )}
                    {n.kind === "condition" ? (
                      <>
                        <span className="absolute -right-[6px] w-2.5 h-2.5 rounded-full border-2 border-surface bg-success" style={{ top: NODE_H * 0.3 - 5 }} aria-hidden />
                        <span className="absolute -right-[6px] w-2.5 h-2.5 rounded-full border-2 border-surface bg-danger" style={{ top: NODE_H * 0.7 - 5 }} aria-hidden />
                      </>
                    ) : (
                      <span className={cn("absolute -right-[6px] top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-surface", ui.port)} aria-hidden />
                    )}

                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className={cn("grid place-items-center w-9 h-9 rounded-lg border shrink-0", ui.icon)} aria-hidden>
                        <Icon className="w-[18px] h-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <span className="inline-block text-[9px] font-bold uppercase tracking-[0.12em] text-text-muted border border-border rounded-full px-1.5 leading-4">
                          {ui.badge}
                        </span>
                        <div className="text-[13px] font-bold leading-tight truncate mt-0.5">{n.title}</div>
                      </div>
                    </div>
                    {n.subtitle && <p className="text-[11px] text-text-muted truncate mt-1.5">{n.subtitle}</p>}
                  </div>
                );
              })}

              {addSlots.map((s) => {
                const p = pos.get(s.id)!;
                const open = openMenu === s.id;
                return (
                  <div key={s.id} className="absolute" style={{ left: p.x, top: p.y, width: ADD_W }} onPointerDown={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setOpenMenu(open ? null : s.id)}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      className="w-full flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-border-strong bg-surface/80 text-xs font-bold text-text-muted hover:text-primary-strong hover:border-primary-strong transition-colors cursor-pointer"
                      style={{ height: ADD_H }}
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                      {s.label}
                    </button>
                    {open && (
                      <div role="menu" className="absolute left-0 top-[calc(100%+6px)] z-30 w-48 bg-surface border border-border rounded-lg shadow-lg p-1">
                        {s.options.map((o) => {
                          const OIcon = o.icon;
                          return (
                            <button
                              key={o.key}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                o.onPick();
                                setOpenMenu(null);
                              }}
                              className="w-full flex items-center gap-2 px-2.5 py-2 text-sm rounded-md hover:bg-surface-2 cursor-pointer text-left"
                            >
                              <OIcon className="w-4 h-4 text-text-muted" aria-hidden />
                              {o.label}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Controles de zoom (canto inferior esquerdo, como no n8n) */}
      <div className="absolute left-4 bottom-14 flex items-center gap-1 bg-surface border border-border rounded-lg shadow-sm p-1">
        <button type="button" onClick={() => setZoom((z) => clampZoom(z - 0.1))} aria-label="Diminuir zoom" className="grid place-items-center w-8 h-8 rounded-md hover:bg-surface-2 cursor-pointer text-text-muted">
          <Minus className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setZoom(1)} className="min-w-12 h-8 px-1 rounded-md hover:bg-surface-2 cursor-pointer text-xs font-bold tabular-nums" aria-label="Voltar ao zoom 100%">
          {Math.round(zoom * 100)}%
        </button>
        <button type="button" onClick={() => setZoom((z) => clampZoom(z + 0.1))} aria-label="Aumentar zoom" className="grid place-items-center w-8 h-8 rounded-md hover:bg-surface-2 cursor-pointer text-text-muted">
          <Plus className="w-4 h-4" />
        </button>
        <span className="w-px h-5 bg-border mx-0.5" aria-hidden />
        <button type="button" onClick={fit} aria-label="Ajustar à tela" title="Ajustar à tela" className="grid place-items-center w-8 h-8 rounded-md hover:bg-surface-2 cursor-pointer text-text-muted">
          <Maximize2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={() => setOffsets({})} aria-label="Organizar nós" title="Organizar nós" className="grid place-items-center w-8 h-8 rounded-md hover:bg-surface-2 cursor-pointer text-text-muted">
          <LayoutGrid className="w-4 h-4" />
        </button>
      </div>

      {/* Rodapé com contagem, como no modelo de referência */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-border bg-surface text-[11px] text-text-muted" role="status" aria-live="polite">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-success" aria-hidden />
            {nodes.length} {nodes.length === 1 ? "nó" : "nós"}
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-primary-strong" aria-hidden />
            {connectionCount} {connectionCount === 1 ? "conexão" : "conexões"}
          </span>
        </div>
        <span className="hidden sm:inline">Arraste os nós pra reorganizar · arraste o fundo pra mover · Ctrl + roda pra zoom</span>
      </div>
    </div>
  );
}
