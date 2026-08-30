"use client";

import { useMemo, useState, useTransition } from "react";
import { updateDealStage, updateDealStagesConfig } from "@/app/actions/deals";
import { formatDealAmount, isDealStale, type DealStage } from "@/lib/deal-stages";
import { DealDrawer } from "@/components/deal-drawer";

type Deal = {
  id: string;
  name: string;
  amount: number | null;
  close_date: string | null;
  status: string;
  stage_id: string;
  stage_changed_at: string;
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  contact_id: string | null;
  contact_name: string | null;
  responsible_user_id: string | null;
};

type Responsible = { id: string; name: string };

type QuickView = "todos" | "abertos" | "atrasados" | "ganhos" | "perdidos";
const QUICK_VIEWS: { key: QuickView; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "abertos", label: "Abertos" },
  { key: "atrasados", label: "Atrasados" },
  { key: "ganhos", label: "Ganhos" },
  { key: "perdidos", label: "Perdidos" },
];

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function DealStagesEditor({
  pipelineId,
  stages: initialStages,
  onSaved,
  onClose,
}: {
  pipelineId: string;
  stages: DealStage[];
  onSaved: (stages: DealStage[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DealStage[]>(initialStages.map((s) => ({ ...s })));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function update(i: number, patch: Partial<DealStage>) {
    setDraft((d) => d.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function move(i: number, dir: -1 | 1) {
    setDraft((d) => {
      const next = [...d];
      const j = i + dir;
      if (j < 0 || j >= next.length) return d;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, idx) => ({ ...s, position: idx }));
    });
  }
  function addStage() {
    setDraft((d) => [...d, { id: "", name: "Novo estágio", position: d.length, color: null, is_won: false, is_lost: false } as DealStage]);
  }
  function removeStage(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, position: idx })));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateDealStagesConfig(
        pipelineId,
        draft.map((s) => ({ id: s.id || undefined, name: s.name, position: s.position, color: s.color, is_won: s.is_won, is_lost: s.is_lost }))
      );
      if (result.error) setError(result.error);
      else {
        onSaved(draft);
        onClose();
      }
    });
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3 shrink-0">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold">Personalizar estágios</h3>
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {draft.map((s, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className="flex flex-col gap-0.5">
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="text-text-muted disabled:opacity-30 cursor-pointer leading-none">▲</button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} className="text-text-muted disabled:opacity-30 cursor-pointer leading-none">▼</button>
            </div>
            <input
              value={s.name}
              onChange={(e) => update(i, { name: e.target.value })}
              className="flex-1 border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            />
            <label className="flex items-center gap-1 text-[11px] font-semibold text-text-muted cursor-pointer">
              <input type="checkbox" checked={s.is_won} onChange={(e) => update(i, { is_won: e.target.checked, is_lost: e.target.checked ? false : s.is_lost })} />
              ganho
            </label>
            <label className="flex items-center gap-1 text-[11px] font-semibold text-text-muted cursor-pointer">
              <input type="checkbox" checked={s.is_lost} onChange={(e) => update(i, { is_lost: e.target.checked, is_won: e.target.checked ? false : s.is_won })} />
              perdido
            </label>
            <button type="button" onClick={() => removeStage(i)} aria-label="Remover estágio" className="text-danger text-xs font-bold px-1 cursor-pointer">×</button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={addStage} className="text-xs font-bold text-primary-strong hover:underline cursor-pointer self-start">
          + estágio
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60 ml-auto"
        >
          Salvar
        </button>
        {error && <span className="text-xs text-danger font-medium">{error}</span>}
      </div>
    </div>
  );
}

function DealCard({
  deal,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  deal: Deal;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
}) {
  const stale = isDealStale(deal.close_date, deal.status);

  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(deal.id)}
      className={`group bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 shadow-sm cursor-grab active:cursor-grabbing
        transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 hover:border-primary-soft ${dragging ? "opacity-40" : ""}`}
    >
      <div className="text-sm font-semibold truncate group-hover:text-primary-strong transition-colors">{deal.name}</div>
      <div className="text-sm font-bold text-primary-strong">{formatDealAmount(deal.amount)}</div>
      {(deal.company_name || deal.contact_name) && (
        <div className="text-[11px] text-text-muted truncate">{deal.company_name || deal.contact_name}</div>
      )}
      <div className="flex items-center gap-1.5 flex-wrap">
        {stale && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">atrasado</span>}
      </div>
      <div className="text-[10.5px] text-text-muted flex items-center justify-between border-t border-border pt-1.5 mt-0.5">
        <span>entrou {formatDateShort(deal.created_at)}</span>
        {deal.close_date && <span>fecha {formatDateShort(deal.close_date)}</span>}
      </div>
    </div>
  );
}

export function DealsBoard({
  deals,
  stages: initialStages,
  pipelineId,
  workspaceId,
  responsibles,
}: {
  deals: Deal[];
  stages: DealStage[];
  pipelineId: string;
  workspaceId: string;
  responsibles: Responsible[];
}) {
  const [items, setItems] = useState(deals);
  const [stages, setStages] = useState(initialStages);
  const [stagesEditorOpen, setStagesEditorOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [quickView, setQuickView] = useState<QuickView>("todos");
  const [responsibleFilter, setResponsibleFilter] = useState("");

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.position - b.position), [stages]);

  const filtered = useMemo(() => {
    return items.filter((d) => {
      if (quickView === "abertos" && d.status !== "open") return false;
      if (quickView === "ganhos" && d.status !== "won") return false;
      if (quickView === "perdidos" && d.status !== "lost") return false;
      if (quickView === "atrasados" && !isDealStale(d.close_date, d.status)) return false;
      if (responsibleFilter && d.responsible_user_id !== responsibleFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${d.name} ${d.company_name || ""} ${d.contact_name || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, search, quickView, responsibleFilter]);

  const quickViewCounts = useMemo(() => {
    const counts: Record<QuickView, number> = { todos: items.length, abertos: 0, atrasados: 0, ganhos: 0, perdidos: 0 };
    for (const d of items) {
      if (d.status === "open") counts.abertos++;
      if (d.status === "won") counts.ganhos++;
      if (d.status === "lost") counts.perdidos++;
      if (isDealStale(d.close_date, d.status)) counts.atrasados++;
    }
    return counts;
  }, [items]);

  function handleDrop(stageId: string) {
    if (!draggingId) return;
    const id = draggingId;
    setDraggingId(null);
    const stage = stages.find((s) => s.id === stageId);
    const status = stage?.is_won ? "won" : stage?.is_lost ? "lost" : "open";
    setItems((prev) => prev.map((d) => (d.id === id ? { ...d, stage_id: stageId, status, stage_changed_at: new Date().toISOString() } : d)));
    startTransition(async () => {
      await updateDealStage(id, stageId);
    });
  }

  const totalOpenAmount = filtered.filter((d) => d.status === "open").reduce((sum, d) => sum + (d.amount || 0), 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      <div className="bg-surface border border-border rounded-xl shadow-sm p-3 flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden>
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome, empresa ou contato…"
              className="w-full border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          {responsibles.length > 0 && (
            <select
              value={responsibleFilter}
              onChange={(e) => setResponsibleFilter(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
            >
              <option value="">Responsável: todos</option>
              {responsibles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}

          <span className="text-xs text-text-muted font-semibold">
            Total aberto: <span className="text-text font-bold">{formatDealAmount(totalOpenAmount)}</span>
          </span>

          <button
            type="button"
            onClick={() => setStagesEditorOpen((v) => !v)}
            className="ml-auto text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            personalizar estágios
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {QUICK_VIEWS.map((qv) => {
            const active = quickView === qv.key;
            return (
              <button
                key={qv.key}
                type="button"
                onClick={() => setQuickView(active ? "todos" : qv.key)}
                className={`text-xs font-bold px-3 py-1.5 rounded-full cursor-pointer border transition-colors ${
                  active ? "border-primary-strong bg-primary-strong text-white" : "border-border text-text-muted hover:border-primary-soft hover:text-primary-strong"
                }`}
              >
                {qv.label} <span className={active ? "opacity-80" : "opacity-60"}>({quickViewCounts[qv.key]})</span>
              </button>
            );
          })}
        </div>
      </div>

      {stagesEditorOpen && (
        <DealStagesEditor
          pipelineId={pipelineId}
          stages={sortedStages}
          onSaved={setStages}
          onClose={() => setStagesEditorOpen(false)}
        />
      )}

      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex gap-3 h-full min-w-full pb-2">
          {sortedStages.map((stage) => {
            const cards = filtered.filter((d) => d.stage_id === stage.id);
            return (
              <div
                key={stage.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage.id)}
                className="flex-1 min-w-[264px] max-w-[360px] flex flex-col bg-surface-2 border border-border rounded-xl min-h-0 transition-colors"
              >
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: stage.color || (stage.is_won ? "var(--color-success)" : stage.is_lost ? "var(--color-danger)" : "var(--color-primary)") }}
                    aria-hidden
                  />
                  <span className="text-xs font-bold flex-1">{stage.name}</span>
                  <span className="text-[11px] text-text-muted font-mono bg-surface rounded-full px-1.5 py-0.5">{cards.length}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
                  {cards.length === 0 ? (
                    <p className="text-[11px] text-text-muted text-center py-6">vazio</p>
                  ) : (
                    cards.map((d) => (
                      <DealCard key={d.id} deal={d} dragging={draggingId === d.id} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} onOpen={setOpenId} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DealDrawer dealId={openId} onClose={() => setOpenId(null)} stages={sortedStages} workspaceId={workspaceId} responsibles={responsibles} />
    </div>
  );
}
