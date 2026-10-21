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
import { moveContactToStage, type PipelineWithStages } from "@/app/actions/pipelines";
import { deleteCrmFilter, saveCrmFilter } from "@/app/actions/crm-saved-filters";
import { countSavedFilters, normalizeSavedFilters, type SavedFilter, type SavedFilterValues } from "@/lib/crm-saved-filters";
import { sortStages, stageForSignal } from "@/lib/pipelines";
import { PipelinesEditor } from "@/components/pipelines-editor";
import { useRouter } from "next/navigation";
import { SORT_OPTIONS, sortContacts, type SortKey } from "@/lib/crm-sorting";
import { buildCrmCsv, downloadCsv, exportFileName } from "@/lib/crm-export";
import type { ContactActivity } from "@/lib/contact-activity";
import { isTaskOverdue } from "@/lib/tasks";
import { bulkAssignTeamMember, bulkMoveContacts } from "@/app/actions/crm-bulk";
import { addTagsToContacts } from "@/app/actions/contacts";
import { analyzeLeads } from "@/app/actions/ai-features";
import { TEMPERATURE_UI, type Temperature } from "@/lib/lead-analysis";
import { isGoogleAdsLead, isMetaCampaignLead } from "@/lib/lead-origin";
import { MetaIcon } from "@/components/meta-icon";
import { GoogleAdsIcon } from "@/components/google-ads-icon";

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
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  tags: string[] | null;
  // Migration 0089: valor estimado do negócio e análise da IA (ausentes antes dela rodar).
  deal_value?: number | null;
  ai_score?: number | null;
  ai_temperature?: string | null;
  ctwa_at?: string | null;
};

// Dica do selo da Meta: qual campanha/anúncio, quando a gente sabe.
function metaOriginTitle(c: Contact) {
  const f = c.custom_fields || {};
  const det = [f.campanha_meta, f.anuncio_meta ?? f.anuncio_titulo].filter((v) => typeof v === "string" && v.trim()).join(" · ");
  const tipo = f.origem === "Facebook" ? "Facebook Leads" : "Anúncio da Meta";
  return det ? `${tipo}: ${det}` : `Veio de campanha da Meta (${tipo})`;
}

// Dica do selo do Google Ads: a campanha (utm_campaign), quando o site repassou.
function googleOriginTitle(c: Contact) {
  const camp = c.custom_fields?.utm_campaign;
  return typeof camp === "string" && camp.trim() ? `Google Ads: ${camp.trim()}` : "Veio de campanha do Google Ads";
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

type FieldFilter = { key: string; value: string };

// Atalhos de visão rápida — mesma ideia dos itens da barra lateral do Kommo (Leads ativos/ganhos/
// perdidos/etc.), só que como fileira de chips em vez de sidebar vertical, já que nosso board é
// horizontal por natureza. "todos" = nenhum filtro de visão aplicado (estado inicial).
type QuickView = "todos" | "atencao" | "quentes" | "campanha" | "google" | "parados" | "ganhos" | "perdidos";
const QUICK_VIEWS: { key: QuickView; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "atencao", label: "Pontos de atenção" },
  { key: "quentes", label: "🔥 Quentes" },
  { key: "campanha", label: "Campanha Meta" },
  { key: "google", label: "Google Ads" },
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

// Um lead pode ter até 30 tags; no card cabem poucas sem virar parede. O resto vai pro "+N", com a
// lista completa no hover e no painel do lead.
const CARD_MAX_TAGS = 3;

// Cartões desenhados por coluna de início, e os passos do "Ver mais".
const CARDS_FIRST = 100;
const CARDS_STEPS = [50, 100, 500] as const;

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: (step: number) => void }) {
  if (shown >= total) return null;
  const remaining = total - shown;
  // Passos que ainda cabem; quando sobra menos que o maior passo, o último botão leva o que resta.
  const steps: number[] = CARDS_STEPS.filter((s) => s < remaining);
  if (steps.length < CARDS_STEPS.length) steps.push(remaining);
  return (
    <div className="flex flex-col items-center gap-1.5 py-2">
      <span className="text-[11px] text-text-muted">
        Mostrando {shown} de {total}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap justify-center">
        {steps.map((step) => (
          <button
            key={step}
            type="button"
            onClick={() => onMore(step)}
            className="text-[11px] font-bold px-2.5 py-1 rounded-md border border-border text-primary-strong hover:border-primary-soft cursor-pointer bg-surface"
          >
            +{step}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatMeeting(iso: string) {
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return `${date} ${time}`;
}

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
  meetingAt,
  selected,
  selecting,
  onToggleSelect,
}: {
  contact: Contact;
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onOpen: (id: string) => void;
  cardDefs: CustomFieldDef[];
  responsibleName: string | null;
  meetingAt: string | null;
  selected: boolean;
  // Com algum card marcado, a caixinha aparece em todos (não só no hover) e clicar no card marca/desmarca.
  selecting: boolean;
  onToggleSelect: (id: string) => void;
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
  const tags = contact.tags ?? [];
  const stage = contact.stage as ContactStage;
  const ageInStage = daysSince(contact.stage_changed_at);
  const stale = ageInStage >= STALE_AFTER_DAYS && stage !== "concluido" && stage !== "descartado";

  return (
    <div
      draggable
      onDragStart={() => onDragStart(contact.id)}
      onDragEnd={onDragEnd}
      onClick={() => (selecting ? onToggleSelect(contact.id) : onOpen(contact.id))}
      className={`group relative bg-surface border rounded-lg p-3 flex flex-col gap-2 shadow-sm cursor-grab active:cursor-grabbing
        transition-all duration-150 hover:shadow-md hover:-translate-y-0.5
        ${selected ? "border-primary ring-2 ring-primary/30" : stale ? "border-border border-l-[3px] border-l-danger hover:border-primary-soft" : "border-border hover:border-primary-soft"}
        ${dragging ? "opacity-40" : ""}`}
    >
      {/* Seleção pra ações em lote (estilo Pipedrive): a caixinha não abre o lead. */}
      <input
        type="checkbox"
        checked={selected}
        onClick={(e) => e.stopPropagation()}
        onChange={() => onToggleSelect(contact.id)}
        aria-label="Selecionar lead"
        className={`absolute top-2 right-2 w-4 h-4 cursor-pointer accent-[var(--color-primary-strong)] ${selecting || selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"}`}
      />
      <div className="flex items-center gap-2 min-w-0 pr-5">
        {contact.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={contact.photo_url} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" aria-hidden />
        ) : (
          <span className="grid place-items-center w-7 h-7 rounded-full bg-primary-soft text-primary-strong text-[10px] font-bold shrink-0" aria-hidden>
            {initials(contact.name, contact.phone, contact.email)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold truncate group-hover:text-primary-strong transition-colors flex items-center gap-1.5">
            <span className="truncate">{contact.name || contact.phone || contact.email || "sem nome"}</span>
            {isMetaCampaignLead(contact) && (
              <span title={metaOriginTitle(contact)} className="shrink-0 inline-flex">
                <MetaIcon size={15} />
              </span>
            )}
            {isGoogleAdsLead(contact) && (
              <span title={googleOriginTitle(contact)} className="shrink-0 inline-flex">
                <GoogleAdsIcon size={14} />
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted truncate">{contact.phone || contact.email || ""}</div>
        </div>
        {contact.deal_value ? <span className="text-xs font-extrabold tabular-nums shrink-0">{brl(Number(contact.deal_value))}</span> : null}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {contact.ai_temperature && TEMPERATURE_UI[contact.ai_temperature as Temperature] && (
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TEMPERATURE_UI[contact.ai_temperature as Temperature].className}`}
            title="Análise da IA (chance de fechar)"
          >
            {TEMPERATURE_UI[contact.ai_temperature as Temperature].icon} {TEMPERATURE_UI[contact.ai_temperature as Temperature].label}
            {contact.ai_score != null ? ` · ${contact.ai_score}` : ""}
          </span>
        )}
        {contact.needs_attention && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger">precisa de atenção</span>}
        {!contact.needs_attention && contact.flagged_reason && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-warning-soft text-warning-text">alerta do agente</span>}
        {meetingAt && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-info-soft text-info-text" title="Reunião marcada pelo agente">
            Reunião {formatMeeting(meetingAt)}
          </span>
        )}
        {stale && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-danger-soft text-danger" title={`Sem mudar de etapa há ${ageInStage} dias`}>⚠ esfriando</span>}
        {contact.lost_reason && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-surface-2 border border-border text-text-muted truncate max-w-[160px]" title={contact.lost_reason}>
            {contact.lost_reason}
          </span>
        )}
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, CARD_MAX_TAGS).map((tag) => (
            <span key={tag} className="text-[10px] font-bold rounded-full bg-primary-soft text-primary-strong px-2 py-0.5 truncate max-w-[130px]" title={tag}>
              {tag}
            </span>
          ))}
          {tags.length > CARD_MAX_TAGS && (
            <span className="text-[10px] font-bold rounded-full bg-surface-2 border border-border text-text-muted px-1.5 py-0.5" title={tags.slice(CARD_MAX_TAGS).join(", ")}>
              +{tags.length - CARD_MAX_TAGS}
            </span>
          )}
        </div>
      )}

      {fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fields.map(([key, value]) => (
            <span key={key} className="text-[10px] bg-surface-2 border border-border rounded px-1.5 py-0.5 text-text-muted truncate max-w-[130px]" title={`${key}: ${value}`}>
              {key}: {value}
            </span>
          ))}
        </div>
      )}

      <div className="text-[10.5px] text-text-muted flex items-center gap-2 border-t border-border pt-1.5 mt-0.5">
        <span className={`shrink-0 ${stale ? "text-danger font-semibold" : ""}`}>{ageInStage === 0 ? "hoje nessa fase" : `${ageInStage}d nessa fase`}</span>
        <span className="ml-auto truncate">entrou {formatDateShort(contact.created_at)}</span>
        {responsibleName && (
          <span
            className="grid place-items-center w-5 h-5 rounded-full bg-info-soft text-info-text text-[9px] font-bold shrink-0"
            title={`Responsável: ${responsibleName}`}
            aria-label={`Responsável: ${responsibleName}`}
          >
            {responsibleName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        )}
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
  pipelines,
  activity,
  meetings = [],
  savedFilters = [],
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
  pipelines: PipelineWithStages[];
  activity: ContactActivity;
  // [contact_id, starts_at] das reuniões futuras, em ordem de início.
  meetings?: [string, string][];
  // Filtros salvos da pessoa logada (cada vendedor monta os seus).
  savedFilters?: SavedFilter[];
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
  const router = useRouter();
  const [pipelinesEditorOpen, setPipelinesEditorOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("recentes");
  const [modoLista, setModoLista] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Map não atravessa a fronteira Server → Client Component, então a atividade chega como par de
  // arrays e é remontada aqui, uma vez só.
  const atividade = useMemo(
    () => ({ nextTaskAt: new Map(activity.nextTaskAt), interactions: new Map(activity.interactions) }),
    [activity]
  );

  // Funil aberto agora. Começa no padrão — é onde cai lead novo, então é o que a equipe olha.
  const [activePipelineId, setActivePipelineId] = useState<string | null>(
    () => pipelines.find((p) => p.is_default)?.id ?? pipelines[0]?.id ?? null
  );
  const activePipeline = pipelines.find((p) => p.id === activePipelineId) ?? null;
  const pipelineStages = useMemo(() => (activePipeline ? sortStages(activePipeline.stages) : []), [activePipeline]);
  // Sem funil cadastrado, o board segue exatamente como sempre foi: as 7 fases com rótulo.
  const modoFunil = pipelineStages.length > 0;

  // Lead que nunca foi movido tem pipeline_id null e pertence ao funil PADRÃO — assim criar um funil
  // não deixa a base histórica invisível nem exige uma migração de dados pra trás.
  const pertenceAoFunil = (c: Contact) =>
    c.pipeline_id ? c.pipeline_id === activePipelineId : Boolean(activePipeline?.is_default);

  // Coluna do card: a etapa gravada, quando ela é deste funil; senão a que corresponde ao SINAL.
  const colunaDe = (c: Contact) => {
    const daqui = c.pipeline_stage_id && pipelineStages.find((e) => e.id === c.pipeline_stage_id);
    if (daqui) return daqui.id;
    return stageForSignal((c.stage as ContactStage) ?? "nao_abordado", pipelineStages)?.id ?? null;
  };
  // Quantos cartões cada coluna desenha (e quantas linhas a lista). Milhares de cartões no DOM travam
  // o navegador; filtros, busca, contagens e exportação continuam olhando todos os leads.
  const [colLimits, setColLimits] = useState<Record<string, number>>({});
  const [listLimit, setListLimit] = useState(CARDS_FIRST);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  // Ações em lote: ids marcados (sobrevive a troca de filtro, como no Pipedrive) e colunas recolhidas.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [collapsedCols, setCollapsedCols] = useState<Set<string>>(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [bulkTag, setBulkTag] = useState("");
  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleCol = (key: string) =>
    setCollapsedCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [quickView, setQuickView] = useState<QuickView>("todos");
  const [stageFilter, setStageFilter] = useState<ContactStage | "">("");
  const [teamFilter, setTeamFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  // WhatsApp = lead com telefone. E-mail = lead que entrou só com e-mail (ex.: formulário do Facebook sem telefone).
  const [channelFilter, setChannelFilter] = useState<"" | "whatsapp" | "email">("");
  const [lostReasonFilter, setLostReasonFilter] = useState("");
  // Tags que tiram o lead da lista (filtrar "pra fora"): quem tem QUALQUER uma delas some do funil.
  const [excludeTags, setExcludeTags] = useState<string[]>([]);
  // Tags que o lead PRECISA ter (qualquer uma delas) — ex.: o departamento que o chatbot marcou.
  const [includeTags, setIncludeTags] = useState<string[]>([]);
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([]);
  const [pickerKey, setPickerKey] = useState("");
  const [pickerValue, setPickerValue] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [saved, setSaved] = useState(savedFilters);
  // null = fechado; string = nome sendo digitado pra salvar os filtros atuais.
  const [savingName, setSavingName] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [savedBusy, setSavedBusy] = useState(false);

  const cardDefs = useMemo(() => fieldDefs.filter((d) => d.show_in_card), [fieldDefs]);

  // A lista configurada mais o que já foi gravado à mão no diálogo de perda — motivo digitado uma
  // vez precisa continuar filtrável mesmo sem estar na lista oficial.
  const motivosEmUso = useMemo(() => {
    const todos = new Set(lostReasons);
    for (const c of items) if (c.lost_reason) todos.add(c.lost_reason);
    return [...todos].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [lostReasons, items]);
  const teamNameById = useMemo(() => new Map(teamMembers.map((m) => [m.id, m.name])), [teamMembers]);
  // Primeira reunião futura de cada lead (a lista já vem em ordem de início).
  const meetingByContact = useMemo(() => {
    const map = new Map<string, string>();
    for (const [contactId, startsAt] of meetings) if (!map.has(contactId)) map.set(contactId, startsAt);
    return map;
  }, [meetings]);
  // Coluna de etiquetas só aparece na lista quando a base usa tag — workspace que nunca marcou
  // nenhuma não ganha uma coluna inteira de travessões.
  const temTags = useMemo(() => items.some((c) => c.tags && c.tags.length > 0), [items]);

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

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of items) for (const t of c.tags ?? []) set.add(t.toLowerCase());
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (quickView === "atencao" && !c.needs_attention && !c.flagged_reason) return false;
      if (quickView === "quentes" && c.ai_temperature !== "quente") return false;
      if (quickView === "campanha" && !isMetaCampaignLead(c)) return false;
      if (quickView === "google" && !isGoogleAdsLead(c)) return false;
      if (quickView === "ganhos" && c.stage !== "concluido") return false;
      if (quickView === "perdidos" && c.stage !== "descartado") return false;
      if (quickView === "parados") {
        const parado = daysSince(c.stage_changed_at) >= STALE_AFTER_DAYS && c.stage !== "concluido" && c.stage !== "descartado";
        if (!parado) return false;
      }
      if (stageFilter && c.stage !== stageFilter) return false;
      if (teamFilter && (teamFilter === "__nenhum__" ? c.team_member_id : c.team_member_id !== teamFilter)) return false;
      if (branchFilter && (branchFilter === "__nenhum__" ? c.branch_id : c.branch_id !== branchFilter)) return false;
      if (channelFilter === "whatsapp" && !c.phone) return false;
      if (channelFilter === "email" && c.phone) return false;
      if (lostReasonFilter) {
        // "sem motivo" só faz sentido dentro da fase de perda — lead ativo não tem motivo por
        // definição, e listar todos eles como "sem motivo" enterraria o que falta preencher.
        if (lostReasonFilter === "__nenhum__" ? c.stage !== LOST_STAGE || c.lost_reason : c.lost_reason !== lostReasonFilter) return false;
      }
      if (excludeTags.length > 0 && (c.tags ?? []).some((t) => excludeTags.includes(t.toLowerCase()))) return false;
      if (includeTags.length > 0 && !(c.tags ?? []).some((t) => includeTags.includes(t.toLowerCase()))) return false;
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
  }, [items, search, dateFrom, dateTo, quickView, stageFilter, teamFilter, branchFilter, channelFilter, lostReasonFilter, excludeTags, includeTags, fieldFilters]);

  // Contagem por atalho — cada item já mostra quantos leads tem ali, igual o resumo do topo do Kommo.
  const quickViewCounts = useMemo(() => {
    const counts: Record<QuickView, number> = { todos: items.length, atencao: 0, quentes: 0, campanha: 0, google: 0, parados: 0, ganhos: 0, perdidos: 0 };
    for (const c of items) {
      if (c.ai_temperature === "quente") counts.quentes++;
      if (isMetaCampaignLead(c)) counts.campanha++;
      if (isGoogleAdsLead(c)) counts.google++;
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

  // Soltar o card numa etapa de funil personalizado. Grava a etapa E o sinal por trás dela: é o
  // sinal que mantém agente, métricas e workflows funcionando sem saber que esse funil existe.
  function handleDropStage(stageId: string) {
    if (!draggingId) return;
    const id = draggingId;
    const antes = items.find((c) => c.id === id);
    setDraggingId(null);
    if (antes && antes.pipeline_stage_id === stageId && antes.pipeline_id === activePipelineId) return;

    const etapa = pipelineStages.find((e) => e.id === stageId);
    if (!etapa) return;

    setItems((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              pipeline_id: activePipelineId,
              pipeline_stage_id: stageId,
              stage: etapa.signal,
              stage_changed_at: new Date().toISOString(),
              lost_reason: null,
            }
          : c
      )
    );
    startTransition(async () => {
      await moveContactToStage(id, stageId);
    });

    if (etapa.signal === LOST_STAGE && askLostReason) {
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

  // As duas formas de montar o board (7 fases fixas, ou etapas de um funil) viram a MESMA lista de
  // colunas aqui, pra o JSX não ter dois caminhos de render que precisam ser mantidos em sincronia.
  const colunas = modoFunil
    ? pipelineStages.map((etapa) => ({
        key: etapa.id,
        label: etapa.name,
        signal: etapa.signal,
        cards: sortContacts(filtered.filter((c) => pertenceAoFunil(c) && colunaDe(c) === etapa.id), sortKey, atividade),
        onDrop: () => handleDropStage(etapa.id),
      }))
    : visibleStages.map((stage) => ({
        key: stage,
        label: stageLabels[stage],
        signal: stage,
        cards: sortContacts(
          filtered.filter((c) => displayStageFor(c.stage as ContactStage, visibleStages) === stage),
          sortKey,
          atividade
        ),
        onDrop: () => handleDrop(stage),
      }));

  // Na visão de lista as colunas não existem: é uma tabela só, com a etapa virando coluna de dado.
  const listaOrdenada = sortContacts(
    modoFunil ? filtered.filter(pertenceAoFunil) : filtered,
    sortKey,
    atividade
  );

  // Nome da etapa de cada lead, pra mostrar na lista sem recalcular por linha.
  const nomeDaEtapa = (c: Contact) => {
    if (!modoFunil) return stageLabels[displayStageFor(c.stage as ContactStage, visibleStages)];
    return pipelineStages.find((e) => e.id === colunaDe(c))?.name ?? "—";
  };

  // Exporta pra planilha o que está na tela: uma fase específica (a coluna do board) ou o funil
  // inteiro. Sai daqui, do cliente, e não de uma action, porque a lista já está filtrada e ordenada
  // em memória — repetir a consulta no servidor só abriria espaço pra planilha divergir do board.
  function handleExport(coluna: { label: string; cards: Contact[] } | null) {
    const leads = coluna ? coluna.cards : listaOrdenada;
    if (leads.length === 0) return;

    const csv = buildCrmCsv(leads, fieldDefs, {
      stageName: (c) => nomeDaEtapa(c as Contact),
      teamName: (id) => (id ? teamNameById.get(id) ?? "" : ""),
      branchName: (id) => (id ? branches.find((b) => b.id === id)?.name ?? "" : ""),
    });
    downloadCsv(exportFileName(activePipeline?.name ?? "pipeline", coluna?.label ?? null), csv);
    setExportOpen(false);
  }

  const propertyFilterCount =
    (dateFrom && dateTo ? 1 : 0) +
    (stageFilter ? 1 : 0) +
    (teamFilter ? 1 : 0) +
    (branchFilter ? 1 : 0) +
    (channelFilter ? 1 : 0) +
    (lostReasonFilter ? 1 : 0) +
    excludeTags.length +
    includeTags.length +
    fieldFilters.length;
  const activeFilterCount = (search ? 1 : 0) + (quickView !== "todos" ? 1 : 0) + propertyFilterCount;

  async function runBulk(kind: "move" | "assign" | "tag", value: string) {
    const ids = [...selected];
    if (ids.length === 0 || !value) return;
    setBulkBusy(true);
    setBulkMsg(null);
    const agora = new Date().toISOString();
    let res: { error: string | null; updated?: number };
    if (kind === "move") {
      const etapa = modoFunil ? pipelineStages.find((e) => e.id === value) : null;
      res = await bulkMoveContacts(ids, modoFunil ? { stageId: value } : { stage: value });
      if (!res.error || (res.updated ?? 0) > 0) {
        setItems((prev) =>
          prev.map((c) =>
            selected.has(c.id)
              ? etapa
                ? { ...c, pipeline_id: activePipelineId, pipeline_stage_id: etapa.id, stage: etapa.signal, stage_changed_at: agora, lost_reason: null }
                : { ...c, stage: value, stage_changed_at: agora, lost_reason: null }
              : c
          )
        );
      }
    } else if (kind === "assign") {
      const memberId = value === "__nenhum__" ? null : value;
      res = await bulkAssignTeamMember(ids, memberId);
      if (!res.error) setItems((prev) => prev.map((c) => (selected.has(c.id) ? { ...c, team_member_id: memberId } : c)));
    } else {
      const tag = value.trim();
      const r = await addTagsToContacts(ids, [tag]);
      res = { error: r.error, updated: r.updated };
      if (!r.error) {
        setItems((prev) =>
          prev.map((c) =>
            selected.has(c.id) && !(c.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase()) ? { ...c, tags: [...(c.tags ?? []), tag] } : c
          )
        );
        setBulkTag("");
      }
    }
    setBulkBusy(false);
    setBulkMsg(res.error ?? `${res.updated ?? ids.length} lead(s) atualizado(s).`);
    if (!res.error) setSelected(new Set());
  }

  async function runBulkAnalysis() {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (ids.length > 25) {
      setBulkMsg("Selecione no máximo 25 leads pra analisar de uma vez.");
      return;
    }
    setBulkBusy(true);
    setBulkMsg(null);
    const r = await analyzeLeads(ids);
    setBulkBusy(false);
    if (r.error !== null) {
      setBulkMsg(r.error);
      return;
    }
    setBulkMsg(`${r.data.done} lead(s) analisado(s)${r.data.failed ? `, ${r.data.failed} sem conversa ou com erro` : ""}.`);
    setSelected(new Set());
    router.refresh();
  }

  function clearFilters() {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setQuickView("todos");
    setStageFilter("");
    setTeamFilter("");
    setBranchFilter("");
    setChannelFilter("");
    setLostReasonFilter("");
    setExcludeTags([]);
    setIncludeTags([]);
    setFieldFilters([]);
  }

  // Filtros salvos: o que está aplicado agora, no formato gravado (sem busca nem período).
  const currentFilters: SavedFilterValues = normalizeSavedFilters({
    quickView,
    stage: stageFilter,
    team: teamFilter,
    branch: branchFilter,
    channel: channelFilter,
    lostReason: lostReasonFilter,
    includeTags,
    excludeTags,
    fields: fieldFilters,
    pipelineId: pipelines.length > 1 ? activePipelineId : null,
  });
  const currentKey = JSON.stringify(currentFilters);
  const canSaveFilters = countSavedFilters(currentFilters) > 0;

  function applySaved(s: SavedFilter) {
    const f = s.filters;
    // Responsável ou filial apagados depois de salvar: o filtro cai, senão esconderia todo mundo.
    const ok = (id: string, list: { id: string }[]) => (id === "__nenhum__" || list.some((x) => x.id === id) ? id : "");
    setQuickView(QUICK_VIEWS.some((q) => q.key === f.quickView) ? (f.quickView as QuickView) : "todos");
    setStageFilter(f.stage as ContactStage | "");
    setTeamFilter(f.team ? ok(f.team, teamMembers) : "");
    setBranchFilter(f.branch ? ok(f.branch, branches) : "");
    setChannelFilter(f.channel);
    setLostReasonFilter(f.lostReason);
    setIncludeTags(f.includeTags);
    setExcludeTags(f.excludeTags);
    setFieldFilters(f.fields);
    if (f.pipelineId && pipelines.some((p) => p.id === f.pipelineId)) setActivePipelineId(f.pipelineId);
    setSavedMsg(null);
  }

  async function saveCurrentFilters() {
    const name = (savingName ?? "").trim();
    if (!name) return;
    setSavedBusy(true);
    setSavedMsg(null);
    const r = await saveCrmFilter(name, currentFilters);
    setSavedBusy(false);
    if (r.error || !r.filter) {
      setSavedMsg(r.error ?? "Não foi possível salvar o filtro.");
      return;
    }
    setSaved((cur) => [...cur, r.filter!]);
    setSavingName(null);
  }

  async function removeSaved(id: string) {
    const antes = saved;
    setSaved((cur) => cur.filter((s) => s.id !== id));
    const r = await deleteCrmFilter(id);
    if (r.error) {
      setSaved(antes);
      setSavedMsg(r.error);
    }
  }

  const totalNoFunil = modoFunil ? items.filter(pertenceAoFunil).length : items.length;
  const valorEmAberto = (modoFunil ? items.filter(pertenceAoFunil) : items)
    .filter((c) => c.stage !== "concluido" && c.stage !== "descartado")
    .reduce((sum, c) => sum + Number(c.deal_value || 0), 0);
  const settingsItems: { label: string; hint: string; onClick: () => void }[] = [
    {
      label: "Campos do lead",
      hint: "o que o lead tem além de nome e telefone",
      onClick: () => {
        setFieldsEditorOpen(true);
        setLabelsEditorOpen(false);
        setPipelinesEditorOpen(false);
      },
    },
    {
      label: "Funis e etapas",
      hint: "criar funil, renomear e ordenar etapas",
      onClick: () => {
        setPipelinesEditorOpen(true);
        setFieldsEditorOpen(false);
        setLabelsEditorOpen(false);
      },
    },
    {
      label: modoFunil ? "Motivos da perda" : "Personalizar fases",
      hint: modoFunil ? "lista de motivos ao descartar" : "nomes, fases ocultas e motivos da perda",
      onClick: () => {
        setLabelsEditorOpen(true);
        setFieldsEditorOpen(false);
        setPipelinesEditorOpen(false);
      },
    },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3">
      {/* Cabeçalho (estilo Pipedrive): título, funil aberto e total; configurações num menu só. */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h1 className="text-2xl font-extrabold tracking-tight">Pipeline</h1>
        {pipelines.length > 1 && (
          <select
            value={activePipelineId ?? ""}
            onChange={(e) => setActivePipelineId(e.target.value)}
            aria-label="Funil"
            className="text-sm font-bold border border-border rounded-md px-2.5 py-1.5 bg-surface outline-none focus:border-primary cursor-pointer"
          >
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
        {pipelines.length === 1 && activePipeline && <span className="text-sm font-bold text-text-muted">{activePipeline.name}</span>}
        <span className="text-sm text-text-muted">{totalNoFunil.toLocaleString("pt-BR")} leads</span>
        {valorEmAberto > 0 && (
          <span className="text-sm text-text-muted">
            · <b className="text-text">{brl(valorEmAberto)}</b> em aberto
          </span>
        )}

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            title="Configurações do pipeline"
            aria-label="Configurações do pipeline"
            className="grid place-items-center w-9 h-9 rounded-md border border-border bg-surface text-text-muted hover:text-text cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" />
              <line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" />
            </svg>
          </button>
          {settingsOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSettingsOpen(false)} aria-hidden />
              <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-surface shadow-lg p-1" role="menu">
                {settingsItems.map((it) => (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      it.onClick();
                      setSettingsOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-surface-2 cursor-pointer"
                  >
                    <span className="block text-sm font-semibold">{it.label}</span>
                    <span className="block text-[11px] text-text-muted">{it.hint}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg shadow-sm p-3 flex flex-col gap-3 shrink-0">
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

          {/* Exportar: a fase é a unidade de trabalho de quem usa a planilha (o vendedor quer a lista
              de agendados, não a base inteira), então cada coluna do board é uma opção própria. */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => {
                setExportOpen((v) => !v);
                setFieldsEditorOpen(false);
                setLabelsEditorOpen(false);
                setPipelinesEditorOpen(false);
              }}
              aria-expanded={exportOpen}
              className="text-xs font-bold px-3 py-2 rounded-md cursor-pointer border border-border text-text-muted hover:text-primary-strong hover:border-primary-soft transition-colors flex items-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              exportar
            </button>

            {exportOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full mt-1 z-50 w-64 rounded-md border border-border bg-surface shadow-lg p-1">
                  <p className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                    Exportar para planilha
                  </p>
                  <button
                    type="button"
                    onClick={() => handleExport(null)}
                    disabled={listaOrdenada.length === 0}
                    className="w-full text-left text-xs font-bold px-3 py-2 rounded cursor-pointer text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                  >
                    <span>Todas as fases</span>
                    <span className="text-text-muted font-normal">{listaOrdenada.length}</span>
                  </button>
                  <div className="my-1 border-t border-border" />
                  {colunas.map((coluna) => (
                    <button
                      key={coluna.key}
                      type="button"
                      onClick={() => handleExport(coluna)}
                      disabled={coluna.cards.length === 0}
                      className="w-full text-left text-xs font-bold px-3 py-2 rounded cursor-pointer text-text hover:bg-surface-2 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{coluna.label}</span>
                      <span className="text-text-muted font-normal">{coluna.cards.length}</span>
                    </button>
                  ))}
                  <p className="px-3 py-2 text-[11px] leading-snug text-text-muted">
                    Sai o que está filtrado na tela, com nome, telefone, e-mail e os campos do lead.
                  </p>
                </div>
              </>
            )}
          </div>

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
                {qv.key === "campanha" && <MetaIcon size={14} className={`inline -mt-0.5 mr-1 ${active ? "brightness-0 invert" : ""}`} />}
                {qv.key === "google" && <GoogleAdsIcon size={13} className="inline -mt-0.5 mr-1" />}
                {qv.label} <span className={active ? "opacity-80" : "opacity-60"}>({quickViewCounts[qv.key]})</span>
              </button>
            );
          })}

          <div className="flex items-center gap-2 ml-auto">
            {/* Kanban x Lista: o Kanban mostra o formato do funil, a lista mostra volume e detalhe.
                Board com centenas de cards por coluna é ruim de ler; a lista resolve isso sem
                inventar um segundo lugar pra mesma informação. */}
            <div className="flex rounded-md border border-border overflow-hidden" role="group" aria-label="Formato de visualização">
              <button
                type="button"
                onClick={() => setModoLista(false)}
                aria-pressed={!modoLista}
                title="Ver em Kanban"
                className={`grid place-items-center w-9 h-9 cursor-pointer transition-colors ${
                  !modoLista ? "bg-primary-strong text-white" : "text-text-muted hover:text-primary-strong"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="4" height="16" rx="1" />
                  <rect x="10" y="4" width="4" height="10" rx="1" />
                  <rect x="17" y="4" width="4" height="13" rx="1" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setModoLista(true)}
                aria-pressed={modoLista}
                title="Ver em lista"
                className={`grid place-items-center w-9 h-9 cursor-pointer transition-colors ${
                  modoLista ? "bg-primary-strong text-white" : "text-text-muted hover:text-primary-strong"
                }`}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3" y2="6" />
                  <line x1="3" y1="12" x2="3" y2="12" />
                  <line x1="3" y1="18" x2="3" y2="18" />
                </svg>
              </button>
            </div>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Ordenar por"
              className="border border-border rounded-md px-2.5 py-2 text-xs font-semibold outline-none focus:border-primary cursor-pointer bg-surface"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Filtros salvos: cada pessoa guarda as combinações que usa (ex.: "Comercial — meus leads")
            e aplica com um clique. São só dela; o resto da equipe tem os seus. */}
        {(saved.length > 0 || canSaveFilters) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted mr-1">Meus filtros</span>
            {saved.map((s) => {
              const active = JSON.stringify(s.filters) === currentKey;
              return (
                <span
                  key={s.id}
                  className={`flex items-center gap-1 text-xs font-bold rounded-full border transition-colors ${
                    active ? "border-info-text bg-info-soft text-info-text" : "border-border text-text-muted hover:border-primary-soft hover:text-primary-strong"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => (active ? clearFilters() : applySaved(s))}
                    aria-pressed={active}
                    title={active ? "Tirar este filtro" : `Aplicar: ${s.name}`}
                    className="pl-3 py-1.5 cursor-pointer"
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSaved(s.id)}
                    aria-label={`Apagar o filtro salvo ${s.name}`}
                    title="Apagar filtro salvo"
                    className="pr-2.5 py-1.5 cursor-pointer opacity-60 hover:opacity-100 hover:text-danger"
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {savingName === null
              ? canSaveFilters &&
                !saved.some((s) => JSON.stringify(s.filters) === currentKey) && (
                  <button
                    type="button"
                    onClick={() => {
                      setSavingName("");
                      setSavedMsg(null);
                    }}
                    className="text-xs font-bold text-primary-strong hover:underline cursor-pointer px-1"
                  >
                    + salvar filtros atuais
                  </button>
                )
              : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    saveCurrentFilters();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    autoFocus
                    value={savingName}
                    onChange={(e) => setSavingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setSavingName(null);
                    }}
                    maxLength={40}
                    placeholder="Nome (ex: Comercial)"
                    aria-label="Nome do filtro salvo"
                    className="border border-border rounded-md px-2 py-1 text-xs outline-none focus:border-primary w-44"
                  />
                  <button
                    type="submit"
                    disabled={savedBusy || !savingName.trim()}
                    className="text-xs font-bold text-primary-strong hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    salvar
                  </button>
                  <button type="button" onClick={() => setSavingName(null)} className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer">
                    cancelar
                  </button>
                </form>
              )}
            {savedMsg && <span className="text-[11px] text-danger">{savedMsg}</span>}
          </div>
        )}

        {filtersOpen && (
          <div className="flex flex-col gap-2.5 border-t border-border pt-3">
            <span className="text-[11px] font-bold uppercase tracking-wide text-text-muted">Propriedades do lead</span>
            <div className="grid sm:grid-cols-2 gap-2.5">
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as ContactStage | "")}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
              >
                <option value="">Etapa: todas</option>
                {/* Em funil personalizado a lista mostra as etapas DAQUELE funil, com os nomes que o
                    cliente deu. O valor continua sendo o sinal, que é por onde o filtro compara —
                    duas etapas com o mesmo significado filtram juntas, o que é o esperado. */}
                {modoFunil
                  ? pipelineStages.map((etapa) => (
                      <option key={etapa.id} value={etapa.signal}>
                        {etapa.name}
                      </option>
                    ))
                  : visibleStages.map((s) => (
                      <option key={s} value={s}>
                        {stageLabels[s]}
                      </option>
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

              <select
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value as "" | "whatsapp" | "email")}
                className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
              >
                <option value="">Canal: todos</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="email">E-mail</option>
              </select>

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

              {allTags.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const t = e.target.value;
                    if (t) setIncludeTags((cur) => (cur.includes(t) ? cur : [...cur, t]));
                  }}
                  title="Mostra só os leads que têm a tag escolhida"
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
                >
                  <option value="">Só com a tag…</option>
                  {allTags
                    .filter((t) => !includeTags.includes(t))
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
              )}

              {allTags.length > 0 && (
                <select
                  value=""
                  onChange={(e) => {
                    const t = e.target.value;
                    if (t) setExcludeTags((cur) => (cur.includes(t) ? cur : [...cur, t]));
                  }}
                  title="Esconde os leads que têm a tag escolhida"
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
                >
                  <option value="">Ocultar tag…</option>
                  {allTags
                    .filter((t) => !excludeTags.includes(t))
                    .map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                </select>
              )}
            </div>

            {includeTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-text-muted">Com a tag:</span>
                {includeTags.map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-[11px] bg-primary-faint text-primary-strong rounded-full px-2.5 py-1">
                    {t}
                    <button type="button" onClick={() => setIncludeTags((cur) => cur.filter((x) => x !== t))} aria-label={`Tirar o filtro da tag ${t}`} className="cursor-pointer font-bold">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

            {excludeTags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-semibold text-text-muted">Sem a tag:</span>
                {excludeTags.map((t) => (
                  <span key={t} className="flex items-center gap-1.5 text-[11px] bg-danger-soft text-danger rounded-full px-2.5 py-1">
                    {t}
                    <button type="button" onClick={() => setExcludeTags((cur) => cur.filter((x) => x !== t))} aria-label={`Voltar a mostrar a tag ${t}`} className="cursor-pointer font-bold">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}

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

      {pipelinesEditorOpen && (
        <PipelinesEditor
          pipelines={pipelines}
          // Funil e etapas vêm do servidor (são estrutura, não estado de tela): depois de salvar, a
          // página recarrega os dados em vez de o board tentar espelhar a mudança na mão.
          onChanged={() => router.refresh()}
          onClose={() => setPipelinesEditorOpen(false)}
        />
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

      {(selected.size > 0 || bulkMsg) && (
        <div className="shrink-0 flex items-center gap-2 flex-wrap bg-primary-strong text-white rounded-xl px-3 py-2 shadow-md">
          {selected.size > 0 ? (
            <>
              <span className="text-sm font-bold mr-1">{selected.size} selecionado(s)</span>
              <select
                value=""
                disabled={bulkBusy}
                onChange={(e) => runBulk("move", e.target.value)}
                className="text-xs font-semibold rounded-md px-2 py-1.5 bg-white/15 border border-white/25 text-white cursor-pointer outline-none [&>option]:text-text"
                aria-label="Mover para etapa"
              >
                <option value="">Mover para…</option>
                {colunas.map((col) => (
                  <option key={col.key} value={col.key}>{col.label}</option>
                ))}
              </select>
              {teamMembers.length > 0 && (
                <select
                  value=""
                  disabled={bulkBusy}
                  onChange={(e) => runBulk("assign", e.target.value)}
                  className="text-xs font-semibold rounded-md px-2 py-1.5 bg-white/15 border border-white/25 text-white cursor-pointer outline-none [&>option]:text-text"
                  aria-label="Atribuir responsável"
                >
                  <option value="">Atribuir a…</option>
                  {teamMembers.filter((m) => m.active).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                  <option value="__nenhum__">Sem responsável</option>
                </select>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  runBulk("tag", bulkTag);
                }}
                className="flex items-center gap-1"
              >
                <input
                  value={bulkTag}
                  onChange={(e) => setBulkTag(e.target.value)}
                  list="crm-bulk-tags"
                  placeholder="Adicionar tag…"
                  className="text-xs rounded-md px-2 py-1.5 w-36 bg-white/15 border border-white/25 text-white placeholder:text-white/70 outline-none"
                />
                <datalist id="crm-bulk-tags">
                  {allTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button type="submit" disabled={bulkBusy || !bulkTag.trim()} className="text-xs font-bold px-2 py-1.5 rounded-md bg-white text-primary-strong cursor-pointer disabled:opacity-50">
                  aplicar
                </button>
              </form>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={runBulkAnalysis}
                title="Lê a conversa de cada lead e dá nota, temperatura e próxima ação (até 25 por vez)"
                className="text-xs font-bold px-2.5 py-1.5 rounded-md bg-white/15 border border-white/25 cursor-pointer disabled:opacity-50"
              >
                ✨ Analisar com IA
              </button>
              {bulkBusy && <span className="text-xs opacity-80">salvando…</span>}
              <button type="button" onClick={() => setSelected(new Set())} className="ml-auto text-xs font-bold underline cursor-pointer">
                limpar seleção
              </button>
            </>
          ) : (
            <>
              <span className="text-sm font-semibold">{bulkMsg}</span>
              <button type="button" onClick={() => setBulkMsg(null)} className="ml-auto text-xs font-bold underline cursor-pointer">
                ok
              </button>
            </>
          )}
        </div>
      )}

      {modoLista ? (
        <div className="flex-1 min-h-0 overflow-auto bg-surface border border-border rounded-xl">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface z-10">
              <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                <th className="pl-3 py-2.5 w-8">
                  <input
                    type="checkbox"
                    aria-label="Selecionar todos da lista"
                    checked={listaOrdenada.length > 0 && listaOrdenada.slice(0, listLimit).every((c) => selected.has(c.id))}
                    onChange={(e) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        for (const c of listaOrdenada.slice(0, listLimit)) {
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                        }
                        return next;
                      })
                    }
                    className="cursor-pointer"
                  />
                </th>
                <th className="px-3 py-2.5">Lead</th>
                <th className="px-3 py-2.5">Etapa</th>
                {teamMembers.length > 0 && <th className="px-3 py-2.5">Responsável</th>}
                {temTags && <th className="px-3 py-2.5">Etiquetas</th>}
                <th className="px-3 py-2.5 whitespace-nowrap">Próxima tarefa</th>
                <th className="px-3 py-2.5 text-right whitespace-nowrap">Interações</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Parado há</th>
                <th className="px-3 py-2.5 whitespace-nowrap">Entrou</th>
              </tr>
            </thead>
            <tbody>
              {listaOrdenada.slice(0, listLimit).map((c) => {
                const parado = daysSince(c.stage_changed_at);
                const tarefa = atividade.nextTaskAt.get(c.id);
                // Mesmo critério da Agenda (vencida = antes de hoje), reaproveitado pra tarefa
                // atrasada não significar uma coisa aqui e outra lá.
                const atrasada = isTaskOverdue(tarefa ?? null, null);
                return (
                  <tr
                    key={c.id}
                    onClick={() => setOpenId(c.id)}
                    className={`border-b border-border last:border-0 cursor-pointer hover:bg-surface-2 transition-colors ${selected.has(c.id) ? "bg-primary-faint" : ""}`}
                  >
                    <td className="pl-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} aria-label="Selecionar lead" className="cursor-pointer" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold truncate max-w-[220px]">{c.name || c.phone || c.email || "sem nome"}</div>
                      <div className="text-[11px] text-text-muted truncate max-w-[220px]">{c.phone || c.email || ""}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[c.stage as ContactStage]}`} aria-hidden />
                        <span className="truncate max-w-[160px]">{nomeDaEtapa(c)}</span>
                      </span>
                      {c.lost_reason && <div className="text-[11px] text-text-muted truncate max-w-[180px]">{c.lost_reason}</div>}
                      {meetingByContact.get(c.id) && (
                        <div className="text-[11px] font-semibold text-info-text whitespace-nowrap">Reunião {formatMeeting(meetingByContact.get(c.id)!)}</div>
                      )}
                    </td>
                    {teamMembers.length > 0 && (
                      <td className="px-3 py-2.5 text-text-muted truncate max-w-[160px]">
                        {(c.team_member_id && teamNameById.get(c.team_member_id)) || "—"}
                      </td>
                    )}
                    {temTags && (
                      <td className="px-3 py-2.5">
                        {c.tags && c.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-[240px]" title={c.tags.join(", ")}>
                            {c.tags.slice(0, CARD_MAX_TAGS).map((tag) => (
                              <span key={tag} className="text-[10px] font-bold rounded-full bg-primary-soft text-primary-strong px-2 py-0.5 truncate max-w-[110px]">
                                {tag}
                              </span>
                            ))}
                            {c.tags.length > CARD_MAX_TAGS && (
                              <span className="text-[10px] font-bold text-text-muted py-0.5">+{c.tags.length - CARD_MAX_TAGS}</span>
                            )}
                          </div>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className={`px-3 py-2.5 whitespace-nowrap ${atrasada ? "text-danger font-semibold" : "text-text-muted"}`}>
                      {tarefa ? formatDateShort(tarefa) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-text-muted">{atividade.interactions.get(c.id) ?? 0}</td>
                    <td className={`px-3 py-2.5 whitespace-nowrap tabular-nums ${parado >= STALE_AFTER_DAYS ? "text-danger font-semibold" : "text-text-muted"}`}>
                      {parado === 0 ? "hoje" : `${parado}d`}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-text-muted">{formatDateShort(c.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {listaOrdenada.length === 0 && <p className="text-sm text-text-muted text-center py-10">Nenhum lead com esses filtros.</p>}
          <ShowMore
            shown={Math.min(listaOrdenada.length, listLimit)}
            total={listaOrdenada.length}
            onMore={(step) => setListLimit((n) => n + step)}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-x-auto">
          {/* Sem minWidth:max-content de propósito — com flex-1 + min-w, poucas colunas esticam pra
              preencher a largura toda; muitas colunas encolhem até o min-w e só aí o overflow-x-auto
              do wrapper entra em ação (scroll horizontal), igual um board profissional de verdade. */}
          <div className="flex gap-3 h-full min-w-full pb-2">
            {colunas.map((coluna) => {
              const cards = coluna.cards;
              const esfriando =
                coluna.signal === "concluido" || coluna.signal === "descartado"
                  ? 0
                  : cards.filter((c) => daysSince(c.stage_changed_at) >= STALE_AFTER_DAYS).length;
              const shownCards = cards.slice(0, colLimits[coluna.key] ?? CARDS_FIRST);
              const allColSelected = shownCards.length > 0 && shownCards.every((c) => selected.has(c.id));
              if (collapsedCols.has(coluna.key)) {
                // Coluna recolhida: vira uma faixa estreita com nome na vertical — continua aceitando card arrastado.
                return (
                  <button
                    key={coluna.key}
                    type="button"
                    onClick={() => toggleCol(coluna.key)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={coluna.onDrop}
                    title={`Expandir ${coluna.label}`}
                    className="w-11 shrink-0 flex flex-col items-center gap-2 py-3 bg-surface-2 border border-border rounded-xl cursor-pointer hover:border-primary-soft"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[coluna.signal]}`} aria-hidden />
                    <span className="text-[11px] text-text-muted font-mono bg-surface rounded-full px-1.5 py-0.5">{cards.length}</span>
                    <span className="text-xs font-bold [writing-mode:vertical-rl] rotate-180 truncate max-h-60">{coluna.label}</span>
                  </button>
                );
              }
              return (
                <div
                  key={coluna.key}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={coluna.onDrop}
                  className="flex-1 min-w-[264px] max-w-[340px] flex flex-col bg-surface-2/70 border border-border rounded-lg min-h-0 transition-colors"
                >
                  <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 shrink-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STAGE_ACCENT[coluna.signal]}`} aria-hidden />
                    <span className="text-xs font-bold flex-1 truncate" title={coluna.label}>{coluna.label}</span>
                    {esfriando > 0 && (
                      <span className="text-[10px] font-bold text-danger" title={`${esfriando} lead(s) parados há ${STALE_AFTER_DAYS}+ dias`}>
                        ⚠ {esfriando}
                      </span>
                    )}
                    <span className="text-[11px] text-text-muted font-mono bg-surface rounded-full px-1.5 py-0.5">{cards.length}</span>
                    {cards.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allColSelected}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            for (const c of shownCards) {
                              if (e.target.checked) next.add(c.id);
                              else next.delete(c.id);
                            }
                            return next;
                          })
                        }
                        title="Selecionar os cards desta coluna"
                        aria-label={`Selecionar os cards de ${coluna.label}`}
                        className="cursor-pointer"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => toggleCol(coluna.key)}
                      title="Recolher coluna"
                      aria-label={`Recolher ${coluna.label}`}
                      className="p-0.5 rounded text-text-muted hover:text-text hover:bg-surface cursor-pointer"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>
                  </div>
                  {(() => {
                    const soma = cards.reduce((sum, c) => sum + Number(c.deal_value || 0), 0);
                    const aberta = coluna.signal !== "concluido" && coluna.signal !== "descartado";
                    if (!soma && !aberta) return null;
                    return (
                      <div className="px-3 pt-1.5 -mb-1 flex items-center justify-between text-[10.5px] text-text-muted">
                        <span className="font-semibold">{soma ? brl(soma) : ""}</span>
                        {aberta && <span>esfria em {STALE_AFTER_DAYS}d</span>}
                      </div>
                    );
                  })()}
                  <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-2">
                    {cards.length === 0 ? (
                      <p className="text-[11px] text-text-muted text-center py-6">vazio</p>
                    ) : (
                      cards.slice(0, colLimits[coluna.key] ?? CARDS_FIRST).map((c) => (
                        <ContactCard
                          key={c.id}
                          contact={c}
                          dragging={draggingId === c.id}
                          onDragStart={setDraggingId}
                          onDragEnd={() => setDraggingId(null)}
                          onOpen={setOpenId}
                          cardDefs={cardDefs}
                          responsibleName={c.team_member_id ? teamNameById.get(c.team_member_id) ?? null : null}
                          meetingAt={meetingByContact.get(c.id) ?? null}
                          selected={selected.has(c.id)}
                          selecting={selected.size > 0}
                          onToggleSelect={toggleSelect}
                        />
                      ))
                    )}
                    <ShowMore
                      shown={Math.min(cards.length, colLimits[coluna.key] ?? CARDS_FIRST)}
                      total={cards.length}
                      onMore={(step) =>
                        setColLimits((prev) => ({ ...prev, [coluna.key]: (prev[coluna.key] ?? CARDS_FIRST) + step }))
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
        onPatched={(id, patch) => setItems((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)))}
      />
    </div>
  );
}
