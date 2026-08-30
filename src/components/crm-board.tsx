"use client";

import { useMemo, useState, useTransition } from "react";
import { updateContactStage, updateCrmStageSettings } from "@/app/actions/contacts";
import { STAGE_ORDER, HIDEABLE_STAGES, getVisibleStages, displayStageFor, STALE_AFTER_DAYS, daysSince, type ContactStage } from "@/lib/crm-stages";
import { CrmLeadDrawer } from "@/components/crm-lead-drawer";
import { GlassDateRangePicker, formatBr } from "@/components/glass-date-range-picker";

type Contact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  photo_url: string | null;
  stage: string;
  stage_changed_at: string;
  custom_fields: Record<string, unknown> | null;
  needs_attention: boolean;
  flagged_reason: string | null;
  created_at: string;
};

type FieldFilter = { key: string; value: string };

// Atalhos de visão rápida — mesma ideia dos itens da barra lateral do Kommo (Leads ativos/ganhos/
// perdidos/etc.), só que como fileira de chips em vez de sidebar vertical, já que nosso board é
// horizontal por natureza. "todos" = nenhum filtro de visão aplicado (estado inicial).
type QuickView = "todos" | "atencao" | "parados" | "ganhos" | "perdidos";
const QUICK_VIEWS: { key: QuickView; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "atencao", label: "Pontos de atenção" },
  { key: "parados", label: "Parados" },
  { key: "ganhos", label: "Ganhos" },
  { key: "perdidos", label: "Perdidos" },
];

const STAGE_ACCENT: Record<ContactStage, string> = {
  nao_abordado: "bg-text-muted",
  abordado: "bg-primary",
  interessado: "bg-info-text",
  encaminhamento: "bg-warning-text",
  fechando_proposta: "bg-primary-strong",
  concluido: "bg-success",
  descartado: "bg-danger",
};

function initials(name: string | null, phone: string | null, email: string | null) {
  const source = (name || phone || email || "?").trim();
  return source.slice(0, 2).toUpperCase();
}
function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function StageLabelsEditor({
  workspaceId,
  labels,
  hiddenStages,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  labels: Record<ContactStage, string>;
  hiddenStages: ContactStage[];
  onSaved: (labels: Record<ContactStage, string>, hiddenStages: ContactStage[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(labels);
  const [hiddenDraft, setHiddenDraft] = useState(hiddenStages);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleHidden(stage: ContactStage) {
    setHiddenDraft((h) => (h.includes(stage) ? h.filter((s) => s !== stage) : [...h, stage]));
  }

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateCrmStageSettings(workspaceId, draft, hiddenDraft);
      if (result.error) setError(result.error);
      else {
        onSaved(draft, hiddenDraft);
        onClose();
      }
    });
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3 shrink-0">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold">Personalizar fases</h3>
          <p className="text-xs text-text-muted mt-0.5">
            Renomeie o texto e esconda as fases do meio que esse cliente não usa. As 4 âncoras (chegada, primeiro
            contato, sucesso e descarte) sempre existem — o sinal que o agente classifica não muda, só a exibição.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>
      <div className="grid sm:grid-cols-2 gap-2.5">
        {STAGE_ORDER.map((stage) => {
          const hideable = (HIDEABLE_STAGES as string[]).includes(stage);
          const hidden = hiddenDraft.includes(stage);
          return (
            <div key={stage} className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono text-text-muted">{stage}</label>
                {hideable && (
                  <button
                    type="button"
                    onClick={() => toggleHidden(stage)}
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full cursor-pointer ${
                      hidden ? "bg-bg text-text-muted" : "bg-primary-faint text-primary-strong"
                    }`}
                  >
                    {hidden ? "oculta" : "visível"}
                  </button>
                )}
              </div>
              <input
                value={draft[stage]}
                onChange={(e) => setDraft((d) => ({ ...d, [stage]: e.target.value }))}
                disabled={hidden}
                className="border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-50"
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
        >
          Salvar
        </button>
        {error && <span className="text-xs text-danger font-medium">{error}</span>}
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
}: {
  contact: Contact;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
}) {
  const fields = Object.entries(contact.custom_fields || {}).slice(0, 3);
  const stage = contact.stage as ContactStage;
  const ageInStage = daysSince(contact.stage_changed_at);
  const stale = ageInStage >= STALE_AFTER_DAYS && stage !== "concluido" && stage !== "descartado";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(contact.id)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(contact.id)}
      className={`group bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 shadow-sm cursor-grab active:cursor-grabbing
        transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 hover:border-primary-soft ${dragging ? "opacity-40" : ""}`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {contact.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={contact.photo_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" aria-hidden />
        ) : (
          <span className="grid place-items-center w-7 h-7 rounded-full bg-primary-soft text-primary-strong text-[10px] font-bold shrink-0" aria-hidden>
            {initials(contact.name, contact.phone, contact.email)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate group-hover:text-primary-strong transition-colors">
            {contact.name || contact.phone || contact.email || "sem nome"}
          </div>
          <div className="text-[11px] text-text-muted truncate">{contact.phone || contact.email || ""}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {contact.needs_attention && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">precisa de atenção</span>}
        {!contact.needs_attention && contact.flagged_reason && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-text">alerta do agente</span>}
        {stale && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">parado {ageInStage}d</span>}
      </div>

      {fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fields.map(([key, value]) => (
            <span key={key} className="text-[10px] font-mono bg-surface-2 border border-border rounded px-1.5 py-0.5 text-text-muted truncate max-w-[130px]" title={`${key}: ${value}`}>
              {key}: {String(value)}
            </span>
          ))}
        </div>
      )}

      <div className="text-[10.5px] text-text-muted flex items-center justify-between border-t border-border pt-1.5 mt-0.5">
        <span>entrou {formatDateShort(contact.created_at)}</span>
        {!stale && <span>{ageInStage === 0 ? "hoje" : `há ${ageInStage}d`}</span>}
      </div>
    </div>
  );
}

export function CrmBoard({
  contacts,
  stageLabels: initialStageLabels,
  hiddenStages: initialHiddenStages,
  workspaceId,
}: {
  contacts: Contact[];
  stageLabels: Record<ContactStage, string>;
  hiddenStages: ContactStage[];
  workspaceId: string;
}) {
  const [items, setItems] = useState(contacts);
  const [stageLabels, setStageLabels] = useState(initialStageLabels);
  const [hiddenStages, setHiddenStages] = useState(initialHiddenStages);
  const [labelsEditorOpen, setLabelsEditorOpen] = useState(false);
  const visibleStages = useMemo(() => getVisibleStages(hiddenStages), [hiddenStages]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [quickView, setQuickView] = useState<QuickView>("todos");
  const [stageFilter, setStageFilter] = useState<ContactStage | "">("");
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([]);
  const [pickerKey, setPickerKey] = useState("");
  const [pickerValue, setPickerValue] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const fieldOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const c of items) {
      for (const [k, v] of Object.entries(c.custom_fields || {})) {
        if (v === null || v === undefined || v === "") continue;
        if (!map.has(k)) map.set(k, new Set());
        map.get(k)!.add(String(v));
      }
    }
    return Array.from(map.entries()).map(([key, values]) => ({ key, values: Array.from(values).sort() }));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (quickView === "atencao" && !c.needs_attention && !c.flagged_reason) return false;
      if (quickView === "ganhos" && c.stage !== "concluido") return false;
      if (quickView === "perdidos" && c.stage !== "descartado") return false;
      if (quickView === "parados") {
        const parado = daysSince(c.stage_changed_at) >= STALE_AFTER_DAYS && c.stage !== "concluido" && c.stage !== "descartado";
        if (!parado) return false;
      }
      if (stageFilter && c.stage !== stageFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.name || ""} ${c.phone || ""} ${c.email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateFrom && c.created_at < dateFrom) return false;
      if (dateTo && c.created_at > `${dateTo}T23:59:59`) return false;
      for (const ff of fieldFilters) {
        if (String((c.custom_fields || {})[ff.key] ?? "") !== ff.value) return false;
      }
      return true;
    });
  }, [items, search, dateFrom, dateTo, quickView, stageFilter, fieldFilters]);

  // Contagem por atalho — cada item já mostra quantos leads tem ali, igual o resumo do topo do Kommo.
  const quickViewCounts = useMemo(() => {
    const counts: Record<QuickView, number> = { todos: items.length, atencao: 0, parados: 0, ganhos: 0, perdidos: 0 };
    for (const c of items) {
      if (c.needs_attention || c.flagged_reason) counts.atencao++;
      if (c.stage === "concluido") counts.ganhos++;
      if (c.stage === "descartado") counts.perdidos++;
      if (daysSince(c.stage_changed_at) >= STALE_AFTER_DAYS && c.stage !== "concluido" && c.stage !== "descartado") counts.parados++;
    }
    return counts;
  }, [items]);

  function handleDrop(stage: ContactStage) {
    if (!draggingId) return;
    const id = draggingId;
    setDraggingId(null);
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, stage, stage_changed_at: new Date().toISOString() } : c)));
    startTransition(async () => {
      await updateContactStage(id, stage);
    });
  }

  function addFieldFilter() {
    if (!pickerKey || !pickerValue) return;
    if (fieldFilters.some((f) => f.key === pickerKey && f.value === pickerValue)) return;
    setFieldFilters((f) => [...f, { key: pickerKey, value: pickerValue }]);
    setPickerValue("");
  }
  function removeFieldFilter(i: number) {
    setFieldFilters((f) => f.filter((_, idx) => idx !== i));
  }

  const activeFilterCount =
    (search ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (quickView !== "todos" ? 1 : 0) + (stageFilter ? 1 : 0) + fieldFilters.length;

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
              placeholder="Buscar por nome, telefone ou e-mail…"
              className="w-full border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className={`text-xs font-bold px-3 py-2 rounded-md cursor-pointer border transition-colors flex items-center gap-1.5 ${
              filtersOpen ? "border-primary-strong text-primary-strong bg-primary-faint" : "border-border text-text-muted hover:text-primary-strong hover:border-primary-soft"
            }`}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            filtros{fieldFilters.length + (dateFrom && dateTo ? 1 : 0) + (stageFilter ? 1 : 0) > 0 ? ` (${fieldFilters.length + (dateFrom && dateTo ? 1 : 0) + (stageFilter ? 1 : 0)})` : ""}
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setQuickView("todos");
                setStageFilter("");
                setFieldFilters([]);
              }}
              className="text-xs font-semibold text-text-muted hover:text-danger cursor-pointer"
            >
              limpar
            </button>
          )}

          <button
            type="button"
            onClick={() => setLabelsEditorOpen((v) => !v)}
            className="ml-auto text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            personalizar fases
          </button>
        </div>

        {/* Atalhos de visão rápida — mesma ideia da sidebar do Kommo (Leads ativos/ganhos/perdidos/
            etc.), aqui como fileira de chips mutuamente exclusivos. */}
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

        {filtersOpen && (
          <div className="flex flex-col gap-2.5 border-t border-border pt-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Propriedades do lead</span>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as ContactStage | "")}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
              >
                <option value="">Estágio: todos</option>
                {visibleStages.map((s) => (
                  <option key={s} value={s}>{stageLabels[s]}</option>
                ))}
              </select>

              <GlassDateRangePicker
                triggerLabel={dateFrom && dateTo ? `Entrou: ${formatBr(dateFrom)} – ${formatBr(dateTo)}` : "Data de entrada"}
                from={dateFrom}
                to={dateTo}
                showPresets={false}
                allowClear
                onApplyRange={(start, end) => {
                  setDateFrom(start);
                  setDateTo(end);
                }}
                onClear={() => {
                  setDateFrom("");
                  setDateTo("");
                }}
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
            <select value={pickerKey} onChange={(e) => { setPickerKey(e.target.value); setPickerValue(""); }} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer mt-2.5">
              <option value="">campo customizado (ex: cidade, gênero)</option>
              {fieldOptions.map((f) => (
                <option key={f.key} value={f.key}>{f.key}</option>
              ))}
            </select>
            <select value={pickerValue} onChange={(e) => setPickerValue(e.target.value)} disabled={!pickerKey} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer disabled:opacity-50 mt-2.5">
              <option value="">valor</option>
              {fieldOptions.find((f) => f.key === pickerKey)?.values.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
            <button type="button" onClick={addFieldFilter} disabled={!pickerKey || !pickerValue} className="text-xs font-bold text-primary-strong hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
              + adicionar
            </button>
            {fieldOptions.length === 0 && <span className="text-xs text-text-muted">Nenhum campo customizado cadastrado ainda nos contatos.</span>}

            {fieldFilters.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 text-[11px] font-mono bg-primary-faint text-primary-strong rounded-full px-2.5 py-1">
                {f.key}: {f.value}
                <button type="button" onClick={() => removeFieldFilter(i)} aria-label="Remover filtro" className="cursor-pointer font-bold">×</button>
              </span>
            ))}
            </div>
          </div>
        )}
      </div>

      {labelsEditorOpen && (
        <StageLabelsEditor
          workspaceId={workspaceId}
          labels={stageLabels}
          hiddenStages={hiddenStages}
          onSaved={(labels, hidden) => {
            setStageLabels(labels);
            setHiddenStages(hidden);
          }}
          onClose={() => setLabelsEditorOpen(false)}
        />
      )}

      {/* Sem minWidth:max-content de propósito — com flex-1 + min-w, poucas colunas esticam pra
          preencher a largura toda; muitas colunas encolhem até o min-w e só aí o overflow-x-auto
          do wrapper entra em ação (scroll horizontal), igual um board profissional de verdade. */}
      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex gap-3 h-full min-w-full pb-2">
          {visibleStages.map((stage) => {
            const cards = filtered.filter((c) => displayStageFor(c.stage as ContactStage, visibleStages) === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage)}
                className="flex-1 min-w-[264px] max-w-[360px] flex flex-col bg-surface-2 border border-border rounded-xl min-h-0 transition-colors"
              >
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[stage]}`} aria-hidden />
                  <span className="text-xs font-bold flex-1">{stageLabels[stage]}</span>
                  <span className="text-[11px] text-text-muted font-mono bg-surface rounded-full px-1.5 py-0.5">{cards.length}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
                  {cards.length === 0 ? (
                    <p className="text-[11px] text-text-muted text-center py-6">vazio</p>
                  ) : (
                    cards.map((c) => (
                      <ContactCard key={c.id} contact={c} dragging={draggingId === c.id} onDragStart={setDraggingId} onDragEnd={() => setDraggingId(null)} onOpen={setOpenId} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <CrmLeadDrawer contactId={openId} onClose={() => setOpenId(null)} stageLabels={stageLabels} workspaceId={workspaceId} />
    </div>
  );
}
