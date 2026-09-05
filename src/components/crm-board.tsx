"use client";

import { useMemo, useState, useTransition } from "react";
import { updateContactStage, updateContactLostReason, updateCrmStageSettings, updateLostReasons } from "@/app/actions/contacts";
import { updateAskLostReason } from "@/app/actions/workspace";
import { STAGE_ORDER, HIDEABLE_STAGES, getVisibleStages, displayStageFor, STALE_AFTER_DAYS, daysSince, type ContactStage } from "@/lib/crm-stages";
import { CrmLeadDrawer } from "@/components/crm-lead-drawer";
import { GlassDateRangePicker, formatBr } from "@/components/glass-date-range-picker";
import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { formatFieldValue, readMultiValue, type CustomFieldDef } from "@/lib/custom-fields";
import { LOST_STAGE } from "@/lib/lost-reasons";
import type { BranchRow, TeamMemberRow } from "@/app/actions/team";

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
  team_member_id: string | null;
  branch_id: string | null;
  lost_reason: string | null;
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
  lostReasons,
  askLostReason,
  onSaved,
  onClose,
}: {
  workspaceId: string;
  labels: Record<ContactStage, string>;
  hiddenStages: ContactStage[];
  lostReasons: string[];
  askLostReason: boolean;
  onSaved: (labels: Record<ContactStage, string>, hiddenStages: ContactStage[], lostReasons: string[], askLostReason: boolean) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(labels);
  const [hiddenDraft, setHiddenDraft] = useState(hiddenStages);
  const [reasonsDraft, setReasonsDraft] = useState(lostReasons.join("\n"));
  const [askDraft, setAskDraft] = useState(askLostReason);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleHidden(stage: ContactStage) {
    setHiddenDraft((h) => (h.includes(stage) ? h.filter((s) => s !== stage) : [...h, stage]));
  }

  function handleSave() {
    setError(null);
    const motivos = reasonsDraft
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    startTransition(async () => {
      const [fases, perdas, perguntar] = await Promise.all([
        updateCrmStageSettings(workspaceId, draft, hiddenDraft),
        updateLostReasons(workspaceId, motivos),
        updateAskLostReason(workspaceId, askDraft),
      ]);
      const erro = fases.error || perdas.error || perguntar.error;
      if (erro) setError(erro);
      else {
        onSaved(draft, hiddenDraft, motivos, askDraft);
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
      <div className="flex flex-col gap-1.5 border-t border-border pt-3">
        <span className="text-sm font-bold">Motivos da perda</span>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={askDraft}
            onChange={(e) => setAskDraft(e.target.checked)}
            className="cursor-pointer accent-[var(--color-primary-strong)]"
          />
          Perguntar o motivo ao mover um card pra fase de perda
        </label>
        <p className="text-xs text-text-muted">
          Desligado, o card só é movido e ninguém é interrompido — o motivo continua podendo ser
          preenchido à mão no painel do lead. Ligado, a lista abaixo é o que aparece no diálogo (um
          por linha) e o que vira o relatório de &quot;por que perdemos&quot; em Métricas; quem move o
          card também pode escrever um motivo fora da lista.
        </p>
        <textarea
          value={reasonsDraft}
          onChange={(e) => setReasonsDraft(e.target.value)}
          rows={6}
          disabled={!askDraft}
          className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface resize-y disabled:opacity-50"
        />
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

// Perguntado no momento em que o card cai na fase de perda. Deixa pular de propósito: obrigar a
// escolher faria as pessoas marcarem qualquer coisa só pra fechar o diálogo, e um relatório com
// motivo inventado é pior do que um com lacuna.
function LostReasonPrompt({
  nome,
  motivos,
  onConfirmar,
  onPular,
}: {
  nome: string;
  motivos: string[];
  onConfirmar: (motivo: string) => void;
  onPular: () => void;
}) {
  const [outro, setOutro] = useState("");

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onPular} aria-hidden />
      <div
        role="dialog"
        aria-label="Motivo da perda"
        className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(420px,calc(100vw-2rem))] bg-surface border border-border rounded-xl shadow-2xl p-5 flex flex-col gap-3"
      >
        <div>
          <h3 className="text-sm font-bold">Por que perdeu esse lead?</h3>
          <p className="text-xs text-text-muted mt-0.5 truncate">{nome}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {motivos.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onConfirmar(m)}
              className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:border-primary-strong hover:text-primary-strong cursor-pointer transition-colors"
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-3">
          <input
            value={outro}
            onChange={(e) => setOutro(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && outro.trim()) onConfirmar(outro.trim());
            }}
            placeholder="ou escreva outro motivo…"
            className="flex-1 border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface"
          />
          <button
            type="button"
            onClick={() => onConfirmar(outro.trim())}
            disabled={!outro.trim()}
            className="bg-primary-strong text-white text-xs font-bold px-3 py-2 rounded-md cursor-pointer disabled:opacity-50"
          >
            Salvar
          </button>
        </div>

        <button type="button" onClick={onPular} className="self-start text-xs font-semibold text-text-muted hover:text-text cursor-pointer">
          pular — registrar depois
        </button>
      </div>
    </>
  );
}

function ContactCard({
  contact,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen,
  cardDefs,
  responsibleName,
}: {
  contact: Contact;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  cardDefs: CustomFieldDef[];
  responsibleName: string | null;
}) {
  // Com esquema definido, o card mostra só os campos marcados como "etiqueta no card" (e pelo
  // rótulo, não pela chave crua). Sem nenhum campo marcado, cai no comportamento antigo: os 3
  // primeiros pares que o lead tiver, pra não deixar o card vazio em quem ainda não configurou.
  const fields =
    cardDefs.length > 0
      ? cardDefs
          .map((def) => [def.label, formatFieldValue(def, (contact.custom_fields || {})[def.key])] as const)
          .filter(([, value]) => value !== "")
      : Object.entries(contact.custom_fields || {})
          .slice(0, 3)
          .map(([k, v]) => [k, Array.isArray(v) ? readMultiValue(v).join(", ") : String(v)] as const);
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
        {contact.lost_reason && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted truncate max-w-[160px]" title={contact.lost_reason}>
            {contact.lost_reason}
          </span>
        )}
      </div>

      {fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fields.map(([key, value]) => (
            <span key={key} className="text-[10px] bg-surface-2 border border-border rounded px-1.5 py-0.5 text-text-muted truncate max-w-[130px]" title={`${key}: ${value}`}>
              {key}: {value}
            </span>
          ))}
        </div>
      )}

      <div className="text-[10.5px] text-text-muted flex items-center justify-between gap-2 border-t border-border pt-1.5 mt-0.5">
        <span className="truncate">{responsibleName ? responsibleName : `entrou ${formatDateShort(contact.created_at)}`}</span>
        {!stale && <span className="shrink-0">{ageInStage === 0 ? "hoje" : `há ${ageInStage}d`}</span>}
      </div>
    </div>
  );
}

export function CrmBoard({
  contacts,
  stageLabels: initialStageLabels,
  hiddenStages: initialHiddenStages,
  workspaceId,
  fieldDefs: initialFieldDefs,
  teamMembers,
  branches,
  lostReasons: initialLostReasons,
  askLostReason: initialAskLostReason,
}: {
  contacts: Contact[];
  stageLabels: Record<ContactStage, string>;
  hiddenStages: ContactStage[];
  workspaceId: string;
  fieldDefs: CustomFieldDef[];
  teamMembers: TeamMemberRow[];
  branches: BranchRow[];
  lostReasons: string[];
  askLostReason: boolean;
}) {
  const [items, setItems] = useState(contacts);
  const [stageLabels, setStageLabels] = useState(initialStageLabels);
  const [hiddenStages, setHiddenStages] = useState(initialHiddenStages);
  const [labelsEditorOpen, setLabelsEditorOpen] = useState(false);
  const [fieldDefs, setFieldDefs] = useState(initialFieldDefs);
  const [fieldsEditorOpen, setFieldsEditorOpen] = useState(false);
  const [lostReasons, setLostReasons] = useState(initialLostReasons);
  const [askLostReason, setAskLostReason] = useState(initialAskLostReason);
  const [perdaPendente, setPerdaPendente] = useState<{ id: string; nome: string } | null>(null);
  const visibleStages = useMemo(() => getVisibleStages(hiddenStages), [hiddenStages]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [quickView, setQuickView] = useState<QuickView>("todos");
  const [stageFilter, setStageFilter] = useState<ContactStage | "">("");
  const [teamFilter, setTeamFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [lostReasonFilter, setLostReasonFilter] = useState("");
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([]);
  const [pickerKey, setPickerKey] = useState("");
  const [pickerValue, setPickerValue] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const cardDefs = useMemo(() => fieldDefs.filter((d) => d.show_in_card), [fieldDefs]);

  // A lista configurada mais o que já foi gravado à mão no diálogo de perda — motivo digitado uma
  // vez precisa continuar filtrável mesmo sem estar na lista oficial.
  const motivosEmUso = useMemo(() => {
    const todos = new Set(lostReasons);
    for (const c of items) if (c.lost_reason) todos.add(c.lost_reason);
    return [...todos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [lostReasons, items]);
  const teamNameById = useMemo(() => new Map(teamMembers.map((m) => [m.id, m.name])), [teamMembers]);

  // Campo COM definição usa a lista de opções cadastrada (aparece mesmo com zero lead preenchido, e
  // na ordem que o cliente definiu). Campo sem definição — herança do formato livre antigo e do que
  // o agente coleta sozinho — continua descoberto a partir dos dados, senão sumiria do filtro.
  const fieldOptions = useMemo(() => {
    const discovered = new Map<string, Set<string>>();
    for (const c of items) {
      for (const [k, v] of Object.entries(c.custom_fields || {})) {
        if (v === null || v === undefined || v === "") continue;
        if (!discovered.has(k)) discovered.set(k, new Set());
        for (const one of Array.isArray(v) ? readMultiValue(v) : [String(v)]) discovered.get(k)!.add(one);
      }
    }

    const out: { key: string; label: string; values: string[] }[] = [];
    for (const def of fieldDefs) {
      const extra = Array.from(discovered.get(def.key) ?? []).filter((v) => !def.options.includes(v));
      out.push({ key: def.key, label: def.label, values: [...def.options, ...extra.sort()] });
      discovered.delete(def.key);
    }
    for (const [key, values] of discovered) {
      out.push({ key, label: key, values: Array.from(values).sort() });
    }
    return out;
  }, [items, fieldDefs]);

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
      if (teamFilter && (teamFilter === "__nenhum__" ? c.team_member_id : c.team_member_id !== teamFilter)) return false;
      if (branchFilter && (branchFilter === "__nenhum__" ? c.branch_id : c.branch_id !== branchFilter)) return false;
      if (lostReasonFilter) {
        // "sem motivo" só faz sentido dentro da fase de perda — lead ativo não tem motivo por
        // definição, e listar todos eles como "sem motivo" enterraria o que falta preencher.
        if (lostReasonFilter === "__nenhum__" ? c.stage !== LOST_STAGE || c.lost_reason : c.lost_reason !== lostReasonFilter) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const hay = `${c.name || ""} ${c.phone || ""} ${c.email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (dateFrom && c.created_at < dateFrom) return false;
      if (dateTo && c.created_at > `${dateTo}T23:59:59`) return false;
      for (const ff of fieldFilters) {
        const raw = (c.custom_fields || {})[ff.key];
        // Multi-seleção casa se QUALQUER valor bate; os outros tipos comparam direto.
        const matches = Array.isArray(raw) ? readMultiValue(raw).includes(ff.value) : String(raw ?? "") === ff.value;
        if (!matches) return false;
      }
      return true;
    });
  }, [items, search, dateFrom, dateTo, quickView, stageFilter, teamFilter, branchFilter, lostReasonFilter, fieldFilters]);

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
    const antes = items.find((c) => c.id === id);
    setDraggingId(null);
    if (antes && antes.stage === stage) return;

    setItems((prev) =>
      prev.map((c) => (c.id === id ? { ...c, stage, stage_changed_at: new Date().toISOString(), lost_reason: null } : c))
    );
    // A mudança de fase é gravada JÁ, sem esperar o motivo. Se dependesse do diálogo, fechar a aba
    // no meio perderia o movimento do card — e o motivo é opcional, o movimento não.
    startTransition(async () => {
      await updateContactStage(id, stage);
    });

    // Perguntar o motivo é configuração do workspace: operação que não trabalha motivo de perda
    // desliga e não ganha um diálogo no meio do caminho.
    if (stage === LOST_STAGE && askLostReason) {
      setPerdaPendente({ id, nome: antes?.name || antes?.phone || antes?.email || "sem nome" });
    }
  }

  function registrarMotivo(motivo: string) {
    const pendente = perdaPendente;
    setPerdaPendente(null);
    if (!pendente || !motivo) return;
    setItems((prev) => prev.map((c) => (c.id === pendente.id ? { ...c, lost_reason: motivo } : c)));
    startTransition(async () => {
      await updateContactLostReason(pendente.id, motivo);
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

  const propertyFilterCount =
    (dateFrom && dateTo ? 1 : 0) +
    (stageFilter ? 1 : 0) +
    (teamFilter ? 1 : 0) +
    (branchFilter ? 1 : 0) +
    (lostReasonFilter ? 1 : 0) +
    fieldFilters.length;
  const activeFilterCount = (search ? 1 : 0) + (quickView !== "todos" ? 1 : 0) + propertyFilterCount;

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setQuickView("todos");
    setStageFilter("");
    setTeamFilter("");
    setBranchFilter("");
    setLostReasonFilter("");
    setFieldFilters([]);
  }

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
            filtros{propertyFilterCount > 0 ? ` (${propertyFilterCount})` : ""}
          </button>

          {activeFilterCount > 0 && (
            <button type="button" onClick={clearFilters} className="text-xs font-semibold text-text-muted hover:text-danger cursor-pointer">
              limpar
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              setFieldsEditorOpen((v) => !v);
              setLabelsEditorOpen(false);
            }}
            className="ml-auto text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </svg>
            campos do lead
          </button>

          <button
            type="button"
            onClick={() => {
              setLabelsEditorOpen((v) => !v);
              setFieldsEditorOpen(false);
            }}
            className="text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
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

              {teamMembers.length > 0 && (
                <select
                  value={teamFilter}
                  onChange={(e) => setTeamFilter(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
                >
                  <option value="">Responsável: todos</option>
                  <option value="__nenhum__">Sem responsável</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.role ? ` — ${m.role}` : ""}
                    </option>
                  ))}
                </select>
              )}

              {branches.length > 0 && (
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
                >
                  <option value="">Filial: todas</option>
                  <option value="__nenhum__">Sem filial</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              )}

              <select
                value={lostReasonFilter}
                onChange={(e) => setLostReasonFilter(e.target.value)}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
              >
                <option value="">Motivo da perda: todos</option>
                <option value="__nenhum__">Perdido sem motivo registrado</option>
                {motivosEmUso.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
            <select value={pickerKey} onChange={(e) => { setPickerKey(e.target.value); setPickerValue(""); }} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer mt-2.5">
              <option value="">campo do lead (ex: cidade, produto)</option>
              {fieldOptions.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
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
            {fieldOptions.length === 0 && (
              <span className="text-xs text-text-muted">
                Nenhum campo do lead ainda — crie em &quot;campos do lead&quot;.
              </span>
            )}

            {fieldFilters.map((f, i) => (
              <span key={i} className="flex items-center gap-1.5 text-[11px] bg-primary-faint text-primary-strong rounded-full px-2.5 py-1">
                {fieldOptions.find((o) => o.key === f.key)?.label ?? f.key}: {f.value}
                <button type="button" onClick={() => removeFieldFilter(i)} aria-label="Remover filtro" className="cursor-pointer font-bold">×</button>
              </span>
            ))}
            </div>
          </div>
        )}
      </div>

      {fieldsEditorOpen && (
        <CustomFieldsEditor defs={fieldDefs} onChanged={setFieldDefs} onClose={() => setFieldsEditorOpen(false)} />
      )}

      {labelsEditorOpen && (
        <StageLabelsEditor
          workspaceId={workspaceId}
          labels={stageLabels}
          hiddenStages={hiddenStages}
          lostReasons={lostReasons}
          askLostReason={askLostReason}
          onSaved={(labels, hidden, motivos, perguntar) => {
            setStageLabels(labels);
            setHiddenStages(hidden);
            setLostReasons(motivos);
            setAskLostReason(perguntar);
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
                      <ContactCard
                        key={c.id}
                        contact={c}
                        dragging={draggingId === c.id}
                        onDragStart={setDraggingId}
                        onDragEnd={() => setDraggingId(null)}
                        onOpen={setOpenId}
                        cardDefs={cardDefs}
                        responsibleName={c.team_member_id ? teamNameById.get(c.team_member_id) ?? null : null}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {perdaPendente && (
        <LostReasonPrompt
          nome={perdaPendente.nome}
          motivos={lostReasons}
          onConfirmar={registrarMotivo}
          onPular={() => setPerdaPendente(null)}
        />
      )}

      <CrmLeadDrawer
        contactId={openId}
        onClose={() => setOpenId(null)}
        stageLabels={stageLabels}
        workspaceId={workspaceId}
        fieldDefs={fieldDefs}
        teamMembers={teamMembers}
        branches={branches}
        lostReasons={lostReasons}
      />
    </div>
  );
}
