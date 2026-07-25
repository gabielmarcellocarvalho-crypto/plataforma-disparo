"use client";

import { useMemo, useState, useTransition } from "react";
import { updateContactStage } from "@/app/actions/contacts";
import { STAGE_ORDER, STAGE_LABELS, STALE_AFTER_DAYS, daysSince, type ContactStage } from "@/lib/crm-stages";
import { CrmLeadDrawer } from "@/components/crm-lead-drawer";

type Contact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  stage_changed_at: string;
  custom_fields: Record<string, unknown> | null;
  needs_attention: boolean;
  flagged_reason: string | null;
  created_at: string;
};

type FieldFilter = { key: string; value: string };

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
        <span className="grid place-items-center w-7 h-7 rounded-full bg-primary-soft text-primary-strong text-[10px] font-bold shrink-0" aria-hidden>
          {initials(contact.name, contact.phone, contact.email)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate group-hover:text-primary-strong transition-colors">
            {contact.name || contact.phone || contact.email || "sem nome"}
          </div>
          <div className="text-[11px] text-text-muted truncate">{contact.phone || contact.email || ""}</div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {contact.needs_attention && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-text">precisa de atenção</span>}
        {!contact.needs_attention && contact.flagged_reason && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-info-soft text-info-text">alerta do agente</span>}
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

export function CrmBoard({ contacts }: { contacts: Contact[] }) {
  const [items, setItems] = useState(contacts);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [onlyAttention, setOnlyAttention] = useState(false);
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
      if (onlyAttention && !c.needs_attention && !c.flagged_reason) return false;
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
  }, [items, search, dateFrom, dateTo, onlyAttention, fieldFilters]);

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

  const activeFilterCount = (search ? 1 : 0) + (dateFrom || dateTo ? 1 : 0) + (onlyAttention ? 1 : 0) + fieldFilters.length;

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

          <div className="flex items-center gap-1.5">
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="border border-border rounded-md px-2 py-2 text-xs outline-none focus:border-primary" />
            <span className="text-xs text-text-muted">até</span>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="border border-border rounded-md px-2 py-2 text-xs outline-none focus:border-primary" />
          </div>

          <button
            type="button"
            onClick={() => setOnlyAttention((v) => !v)}
            className={`text-xs font-bold px-3 py-2 rounded-md cursor-pointer border transition-colors ${
              onlyAttention ? "bg-warning-soft text-warning-text border-warning-soft" : "border-border text-text-muted"
            }`}
          >
            só pontos de atenção
          </button>

          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            className="text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            filtros{fieldFilters.length > 0 ? ` (${fieldFilters.length})` : ""}
          </button>

          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setDateFrom("");
                setDateTo("");
                setOnlyAttention(false);
                setFieldFilters([]);
              }}
              className="text-xs font-semibold text-text-muted hover:text-danger cursor-pointer"
            >
              limpar
            </button>
          )}
        </div>

        {filtersOpen && (
          <div className="flex items-center gap-2 flex-wrap border-t border-border pt-3">
            <select value={pickerKey} onChange={(e) => { setPickerKey(e.target.value); setPickerValue(""); }} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer">
              <option value="">campo (ex: cidade, gênero)</option>
              {fieldOptions.map((f) => (
                <option key={f.key} value={f.key}>{f.key}</option>
              ))}
            </select>
            <select value={pickerValue} onChange={(e) => setPickerValue(e.target.value)} disabled={!pickerKey} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer disabled:opacity-50">
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
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto">
        <div className="flex gap-4 h-full pb-2" style={{ minWidth: "max-content" }}>
          {STAGE_ORDER.map((stage) => {
            const cards = filtered.filter((c) => c.stage === stage);
            return (
              <div
                key={stage}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(stage)}
                className="w-[268px] shrink-0 flex flex-col bg-surface-2 border border-border rounded-xl min-h-0 transition-colors"
              >
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[stage]}`} aria-hidden />
                  <span className="text-xs font-bold flex-1">{STAGE_LABELS[stage]}</span>
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

      <CrmLeadDrawer contactId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
