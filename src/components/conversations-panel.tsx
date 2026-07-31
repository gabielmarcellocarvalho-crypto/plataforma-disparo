"use client";

import { useMemo, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { takeOverConversation, resolveAttention, sendManualMessage, clearConversationHistory, dismissFlag } from "@/app/actions/conversations";
import { updateContactResponsible, updateContactStage } from "@/app/actions/contacts";
import { CrmLeadDrawer } from "@/components/crm-lead-drawer";
import { STAGE_ORDER } from "@/lib/crm-stages";

// Mesma leitura de cor por etapa do Kanban — só exibe aqui, quem move o card é o CRM (arrastar) ou
// o agente de IA sozinho ([[STATUS: ...]]), nunca essa tela.
const STAGE_BADGE: Record<string, string> = {
  nao_abordado: "bg-bg text-text-muted",
  abordado: "bg-primary-soft text-primary-strong",
  interessado: "bg-info-soft text-info-text",
  encaminhamento: "bg-warning-soft text-warning-text",
  fechando_proposta: "bg-primary-soft text-primary-strong",
  concluido: "bg-success-soft text-success",
  descartado: "bg-danger-soft text-danger",
};

const WAIT_THRESHOLDS = [
  { key: "1", label: "> 1 hora", ms: 1 * 3_600_000 },
  { key: "6", label: "> 6 horas", ms: 6 * 3_600_000 },
  { key: "24", label: "> 1 dia", ms: 24 * 3_600_000 },
  { key: "72", label: "> 3 dias", ms: 72 * 3_600_000 },
];

type Contact = {
  id: string;
  name: string | null;
  phone: string | null;
  stage: string;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  responsible_user_id: string | null;
  origin_campaign: string | null;
};
type Agent = { id: string; name: string; photo_url: string | null; evolution_instance_name: string };
type Message = { id: string; contact_id: string; agent_id: string | null; role: string; content: string; created_at: string };
export type Vendor = { id: string; name: string };

export type Conversation = { contact: Contact; agent: Agent; messages: Message[] };

function initials(name: string | null, phone: string | null) {
  const source = (name || phone || "?").trim();
  return source.slice(0, 2).toUpperCase();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationsPanel({
  conversations,
  stageLabels,
  visibleStages,
  vendors,
  showResponsavel,
}: {
  conversations: Conversation[];
  stageLabels: Record<string, string>;
  visibleStages: string[];
  vendors: Vendor[];
  showResponsavel: boolean;
}) {
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");

  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stageFilter, setStageFilter] = useState("");
  const [aguardandoHumano, setAguardandoHumano] = useState(false);
  const [semResposta, setSemResposta] = useState(false);
  const [waitFilter, setWaitFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [responsavelFilter, setResponsavelFilter] = useState("");

  // Vindo do CRM (?contact=<id>), abre direto a conversa dessa pessoa; senão, a mais recente.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    if (contactParam) {
      const found = conversations.find((c) => c.contact.id === contactParam);
      if (found) return keyOf(found);
    }
    return conversations[0] ? keyOf(conversations[0]) : null;
  });
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);

  const campaignOptions = useMemo(
    () => Array.from(new Set(conversations.map((c) => c.contact.origin_campaign).filter((v): v is string => Boolean(v)))).sort(),
    [conversations]
  );

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return conversations.filter((c) => {
      if (q && !(c.contact.name || "").toLowerCase().includes(q) && !(c.contact.phone || "").includes(q)) return false;
      if (stageFilter && c.contact.stage !== stageFilter) return false;
      if (aguardandoHumano && !c.contact.needs_attention) return false;
      const last = c.messages[0];
      if (semResposta && last?.role !== "assistant") return false;
      if (waitFilter && last) {
        const threshold = WAIT_THRESHOLDS.find((w) => w.key === waitFilter);
        if (threshold && Date.now() - new Date(last.created_at).getTime() < threshold.ms) return false;
      }
      if (campaignFilter && c.contact.origin_campaign !== campaignFilter) return false;
      if (responsavelFilter) {
        if (responsavelFilter === "__nenhum__" ? c.contact.responsible_user_id : c.contact.responsible_user_id !== responsavelFilter) return false;
      }
      return true;
    });
  }, [conversations, query, stageFilter, aguardandoHumano, semResposta, waitFilter, campaignFilter, responsavelFilter]);

  const activeFilterCount =
    (stageFilter ? 1 : 0) + (aguardandoHumano ? 1 : 0) + (semResposta ? 1 : 0) + (waitFilter ? 1 : 0) + (campaignFilter ? 1 : 0) + (responsavelFilter ? 1 : 0);

  const selected = conversations.find((c) => keyOf(c) === selectedKey) || null;
  const orderedMessages = selected ? [...selected.messages].reverse() : [];

  function handleTakeOver(contactId: string) {
    setError(null);
    startTransition(async () => {
      const result = await takeOverConversation(contactId);
      if (result.error) setError(result.error);
    });
  }

  function handleResolve(contactId: string) {
    setError(null);
    startTransition(async () => {
      const result = await resolveAttention(contactId);
      if (result.error) setError(result.error);
    });
  }

  function handleDismissFlag(contactId: string) {
    setError(null);
    startTransition(async () => {
      const result = await dismissFlag(contactId);
      if (result.error) setError(result.error);
    });
  }

  function handleResponsavel(contactId: string, userId: string) {
    startTransition(async () => {
      await updateContactResponsible(contactId, userId);
    });
  }

  function handleStageChange(contactId: string, stage: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateContactStage(contactId, stage);
      if (result.error) setError(result.error);
    });
  }

  function handleClearHistory(contactId: string, agentId: string) {
    if (!window.confirm("Apagar todo o histórico dessa conversa? O agente esquece tudo que já foi falado com esse contato. Não dá pra desfazer.")) return;
    setError(null);
    startTransition(async () => {
      const result = await clearConversationHistory(contactId, agentId);
      if (result.error) setError(result.error);
      else setSelectedKey(null);
    });
  }

  function handleSend() {
    if (!selected || !draft.trim()) return;
    setError(null);
    const text = draft;
    startTransition(async () => {
      const result = await sendManualMessage(selected.contact.id, selected.agent.id, text);
      if (result.error) setError(result.error);
      else setDraft("");
    });
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border flex flex-col gap-2">
          <div className="flex items-center gap-1.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar conversa…"
              className="flex-1 min-w-0 border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((v) => !v)}
              title="Filtros"
              className={`relative shrink-0 grid place-items-center w-9 h-9 rounded-md cursor-pointer border transition-colors ${
                filtersOpen || activeFilterCount > 0 ? "border-primary-strong text-primary-strong bg-primary-faint" : "border-border text-text-muted hover:border-primary-soft"
              }`}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              {activeFilterCount > 0 && (
                <span className="absolute translate-x-3 -translate-y-3 min-w-[15px] h-[15px] px-0.5 rounded-full bg-primary-strong text-white text-[9px] font-bold grid place-items-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {filtersOpen && (
            <div className="flex flex-col gap-2 pt-1 border-t border-border">
              <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer bg-surface">
                <option value="">Etapa: todas</option>
                {visibleStages.map((s) => (
                  <option key={s} value={s}>{stageLabels[s] || s}</option>
                ))}
              </select>

              <select value={waitFilter} onChange={(e) => setWaitFilter(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer bg-surface">
                <option value="">Tempo de espera: qualquer</option>
                {WAIT_THRESHOLDS.map((w) => (
                  <option key={w.key} value={w.key}>{w.label}</option>
                ))}
              </select>

              {campaignOptions.length > 0 && (
                <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer bg-surface">
                  <option value="">Campanha de origem: todas</option>
                  {campaignOptions.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              )}

              {showResponsavel && vendors.length > 0 && (
                <select value={responsavelFilter} onChange={(e) => setResponsavelFilter(e.target.value)} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer bg-surface">
                  <option value="">Responsável: todos</option>
                  <option value="__nenhum__">Sem responsável</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => setAguardandoHumano((v) => !v)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer border transition-colors ${
                    aguardandoHumano ? "border-primary-strong bg-primary-strong text-white" : "border-border text-text-muted"
                  }`}
                >
                  Aguardando humano
                </button>
                <button
                  type="button"
                  onClick={() => setSemResposta((v) => !v)}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer border transition-colors ${
                    semResposta ? "border-primary-strong bg-primary-strong text-white" : "border-border text-text-muted"
                  }`}
                >
                  Sem resposta do lead
                </button>
                {activeFilterCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setStageFilter("");
                      setAguardandoHumano(false);
                      setSemResposta(false);
                      setWaitFilter("");
                      setCampaignFilter("");
                      setResponsavelFilter("");
                    }}
                    className="text-[11px] font-semibold text-text-muted hover:text-danger cursor-pointer ml-auto"
                  >
                    limpar
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted p-4 text-center">Nenhuma conversa encontrada.</p>
          ) : (
            filtered.map((c) => {
              const key = keyOf(c);
              const last = c.messages[0];
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-3 border-b border-border cursor-pointer ${
                    active ? "bg-primary-faint" : "hover:bg-bg"
                  }`}
                >
                  <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
                    {initials(c.contact.name, c.contact.phone)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold truncate flex items-center gap-1 min-w-0">
                        {c.contact.needs_attention && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-danger shrink-0" aria-hidden>
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12" y2="17" />
                          </svg>
                        )}
                        {!c.contact.needs_attention && c.contact.flagged_reason && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-warning-text shrink-0" aria-hidden>
                            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                            <line x1="4" y1="22" x2="4" y2="15" />
                          </svg>
                        )}
                        <span className="truncate">{c.contact.name || c.contact.phone || "sem nome"}</span>
                      </span>
                      <span
                        title="Etapa do funil (muda pelo Kanban ou automaticamente pelo agente)"
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${STAGE_BADGE[c.contact.stage] || STAGE_BADGE.nao_abordado}`}
                      >
                        {stageLabels[c.contact.stage] || c.contact.stage}
                      </span>
                      {last && <time className="text-xs text-text-muted shrink-0">{formatTime(last.created_at)}</time>}
                    </div>
                    <p className="text-sm text-text-muted truncate mt-0.5">
                      {c.contact.needs_attention
                        ? c.contact.attention_reason || "Precisa de atenção"
                        : c.contact.flagged_reason || last?.content || ""}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        {!selected ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">Selecione uma conversa</div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-wrap">
              <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
                {initials(selected.contact.name, selected.contact.phone)}
              </span>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setDrawerContactId(selected.contact.id)}
                  title="Ver detalhes do lead"
                  className="text-base font-bold truncate hover:underline cursor-pointer text-left"
                >
                  {selected.contact.name || selected.contact.phone}
                </button>
                <div className="text-sm text-text-muted truncate">{selected.contact.phone} · agente {selected.agent.name}</div>
              </div>

              <select
                value={selected.contact.stage}
                onChange={(e) => handleStageChange(selected.contact.id, e.target.value)}
                disabled={pending}
                title="Etapa do CRM"
                className={`text-xs font-bold px-2.5 py-2 rounded-md shrink-0 cursor-pointer border-none outline-none disabled:opacity-60 ${STAGE_BADGE[selected.contact.stage] || STAGE_BADGE.nao_abordado}`}
              >
                {STAGE_ORDER.map((s) => (
                  <option key={s} value={s}>{stageLabels[s] || s}</option>
                ))}
              </select>

              {showResponsavel && vendors.length > 0 && (
                <select
                  value={selected.contact.responsible_user_id || ""}
                  onChange={(e) => handleResponsavel(selected.contact.id, e.target.value)}
                  disabled={pending}
                  title="Vendedor responsável por esse lead"
                  className="text-xs font-bold px-2.5 py-2 rounded-md shrink-0 cursor-pointer border border-border text-text-muted disabled:opacity-60 outline-none focus:border-primary bg-surface"
                >
                  <option value="">Sem responsável</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => handleClearHistory(selected.contact.id, selected.agent.id)}
                disabled={pending}
                title="Apaga o histórico dessa conversa (o agente esquece tudo)"
                className="text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer border border-border text-text-muted disabled:opacity-60"
              >
                Limpar conversa
              </button>
              <button
                type="button"
                onClick={() => (selected.contact.needs_attention ? handleResolve(selected.contact.id) : handleTakeOver(selected.contact.id))}
                disabled={pending}
                className={`text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer disabled:opacity-60 ${
                  selected.contact.needs_attention ? "bg-primary-strong text-white" : "border border-border text-text-muted"
                }`}
              >
                {selected.contact.needs_attention ? "Devolver pro agente" : "Assumir conversa"}
              </button>
            </div>

            {selected.contact.needs_attention && (
              <div className="bg-danger-soft text-danger text-xs font-semibold px-4 py-2">
                {selected.contact.attention_reason || "Conversa assumida manualmente."} O agente não responde até você devolver.
              </div>
            )}

            {!selected.contact.needs_attention && selected.contact.flagged_reason && (
              <div className="bg-warning-soft text-warning-text text-xs font-semibold px-4 py-2 flex items-center justify-between gap-3">
                <span>{selected.contact.flagged_reason} O agente continua respondendo normalmente.</span>
                <button
                  type="button"
                  onClick={() => handleDismissFlag(selected.contact.id)}
                  disabled={pending}
                  className="underline shrink-0 cursor-pointer disabled:opacity-60"
                >
                  Dispensar
                </button>
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
              {orderedMessages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-lg px-3.5 py-2.5 text-[15px] leading-relaxed ${
                    m.role === "user" ? "bg-bg self-start" : "bg-primary-soft text-primary-strong self-end"
                  }`}
                >
                  {m.content}
                  <div className="text-xs text-text-muted mt-1">{formatTime(m.created_at)}</div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 p-3 border-t border-border"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!selected.contact.needs_attention || pending}
                placeholder={selected.contact.needs_attention ? "Escreva a mensagem…" : "Assuma a conversa pra escrever manualmente"}
                className="flex-1 border border-border rounded-md px-3.5 py-2.5 text-[15px] outline-none focus:border-primary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!selected.contact.needs_attention || pending || !draft.trim()}
                className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Enviar
              </button>
            </form>
          </>
        )}
        {error && <p className="text-xs text-danger font-medium px-4 pb-2">{error}</p>}
      </div>

      <CrmLeadDrawer contactId={drawerContactId} onClose={() => setDrawerContactId(null)} stageLabels={stageLabels} />
    </div>
  );
}

function keyOf(c: Conversation) {
  return `${c.contact.id}:${c.agent.id}`;
}
