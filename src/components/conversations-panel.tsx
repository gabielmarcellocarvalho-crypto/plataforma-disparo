"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  takeOverConversation,
  resolveAttention,
  sendManualMessage,
  sendManualMedia,
  clearConversationHistory,
  dismissFlag,
  sendInstanceMessage,
  sendInstanceMedia,
  clearInstanceConversationHistory,
} from "@/app/actions/conversations";
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
  photo_url: string | null;
  stage: string;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  responsible_user_id: string | null;
  origin_campaign: string | null;
};
type Agent = { id: string; name: string; photo_url: string | null; evolution_instance_name: string };
// Conversa de número sem agente de IA (disparo avulso) — "name" já vem traduzido (Vendas/Financeiro).
type Instance = { id: string; name: string; channel: "evolution" | "360dialog" };
type Message = {
  id: string;
  contact_id: string;
  agent_id: string | null;
  role: string;
  content: string;
  media_url: string | null;
  media_type: "image" | "audio" | "document" | null;
  created_at: string;
};
export type Vendor = { id: string; name: string };

// Sempre exatamente um dos dois presente: agent (conversa com IA) OU instance (disparo avulso, humano
// sempre responde manualmente).
export type Conversation = { contact: Contact; agent: Agent | null; instance: Instance | null; messages: Message[] };

function initials(name: string | null, phone: string | null) {
  const source = (name || phone || "?").trim();
  return source.slice(0, 2).toUpperCase();
}

function Avatar({ photoUrl, name, phone, size }: { photoUrl: string | null; name: string | null; phone: string | null; size: "sm" | "md" | "lg" }) {
  const sizeClass = size === "sm" ? "w-10 h-10 text-xs" : size === "md" ? "w-11 h-11 text-sm" : "w-14 h-14 text-base";
  if (photoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={photoUrl} alt="" className={`${sizeClass} rounded-full object-cover shrink-0`} aria-hidden />;
  }
  return (
    <span className={`grid place-items-center ${sizeClass} rounded-full bg-primary-soft text-primary-strong font-bold shrink-0`} aria-hidden>
      {initials(name, phone)}
    </span>
  );
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

// Placeholders sintéticos que o backend grava quando não há texto de verdade pra acompanhar a mídia
// (foto sem legenda) — não faz sentido mostrar esse texto técnico junto do preview visual.
const MEDIA_ONLY_PLACEHOLDER = /^\[(o cliente enviou uma foto|arquivo enviado: .*)\]$/;

function MediaAttachment({ url, type }: { url: string; type: "image" | "audio" | "document" }) {
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Imagem da conversa" className="max-w-full max-h-64 rounded-lg border border-border object-cover" />
      </a>
    );
  }
  if (type === "audio") {
    return (
      <audio controls src={url} className="w-full max-w-[240px] mb-1.5 h-9">
        Seu navegador não suporta áudio.
      </audio>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-sm font-semibold underline mb-1.5">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
      </svg>
      Ver arquivo
    </a>
  );
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  const [refreshing, startRefresh] = useTransition();

  function handleRefresh() {
    startRefresh(() => router.refresh());
  }

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
  // Em telas < md as duas colunas (lista/chat) não cabem lado a lado — esse estado decide qual das
  // duas aparece (irrelevante em telas >= md, onde as duas ficam sempre visíveis).
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drawerContactId, setDrawerContactId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

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
  // Composer travado: conversa com agente de IA que ainda não foi assumida manualmente, ou uma
  // ação em andamento — mesma regra pro texto, anexo e gravação de áudio.
  const composerLocked = (Boolean(selected?.agent) && !selected?.contact.needs_attention) || pending;

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

  function handleClearHistory(contactId: string, agentId: string | null) {
    const msg = agentId
      ? "Apagar todo o histórico dessa conversa? O agente esquece tudo que já foi falado com esse contato. Não dá pra desfazer."
      : "Apagar todo o histórico dessa conversa? Não dá pra desfazer.";
    if (!window.confirm(msg)) return;
    setError(null);
    startTransition(async () => {
      const result = agentId ? await clearConversationHistory(contactId, agentId) : await clearInstanceConversationHistory(contactId);
      if (result.error) setError(result.error);
      else setSelectedKey(null);
    });
  }

  function handleSend() {
    if (!selected || !draft.trim()) return;
    setError(null);
    const text = draft;
    startTransition(async () => {
      const result = selected.agent
        ? await sendManualMessage(selected.contact.id, selected.agent.id, text)
        : await sendInstanceMessage(selected.contact.id, selected.instance!.id, text);
      if (result.error) setError(result.error);
      else setDraft("");
    });
  }

  function handleSendFile(file: File) {
    if (!selected) return;
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    startTransition(async () => {
      const result = selected.agent
        ? await sendManualMedia(selected.contact.id, selected.agent.id, formData)
        : await sendInstanceMedia(selected.contact.id, selected.instance!.id, formData);
      if (result.error) setError(result.error);
    });
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (file) handleSendFile(file);
  }

  async function handleToggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          const ext = mimeType.includes("mp4") ? "m4a" : "webm";
          handleSendFile(new File([blob], `audio-${Date.now()}.${ext}`, { type: mimeType }));
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch {
      setError("Não foi possível acessar o microfone (verifique a permissão do navegador).");
    }
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[320px_1fr] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
      <div className={`border-r border-border flex-col min-h-0 ${mobileView === "chat" ? "hidden md:flex" : "flex"}`}>
        <div className="p-4 border-b border-border flex flex-col gap-2.5">
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
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Atualizar conversas"
              aria-label="Atualizar conversas"
              className="shrink-0 grid place-items-center w-9 h-9 rounded-md cursor-pointer border border-border text-text-muted hover:border-primary-soft disabled:opacity-60"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
                className={refreshing ? "animate-spin" : ""}
              >
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
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
                  onClick={() => {
                    setSelectedKey(key);
                    setMobileView("chat");
                  }}
                  className={`relative w-full text-left flex items-center gap-3 px-4 py-3.5 border-b border-border cursor-pointer transition-colors ${
                    active ? "bg-primary-faint" : "hover:bg-bg"
                  }`}
                >
                  {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-8 w-1 rounded-r-full bg-primary-strong" aria-hidden />}
                  <Avatar photoUrl={c.contact.photo_url} name={c.contact.name} phone={c.contact.phone} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[15px] font-semibold truncate flex items-center gap-1.5 min-w-0">
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
                    <p className="text-sm text-text-muted truncate mt-1">
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

      <div className={`flex-col min-h-0 ${mobileView === "list" ? "hidden md:flex" : "flex"}`}>
        {!selected ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">Selecione uma conversa</div>
        ) : (
          <>
            <div className="flex items-center gap-3.5 px-5 py-4 border-b border-border flex-wrap">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                aria-label="Voltar pra lista de conversas"
                className="md:hidden grid place-items-center w-8 h-8 rounded-md border border-border text-text-muted cursor-pointer shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => setDrawerContactId(selected.contact.id)}
                title="Ver detalhes do lead"
                className="cursor-pointer shrink-0"
              >
                <Avatar photoUrl={selected.contact.photo_url} name={selected.contact.name} phone={selected.contact.phone} size="md" />
              </button>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => setDrawerContactId(selected.contact.id)}
                  title="Ver detalhes do lead"
                  className="text-base font-bold truncate hover:underline cursor-pointer text-left"
                >
                  {selected.contact.name || selected.contact.phone}
                </button>
                <div className="text-sm text-text-muted truncate mt-0.5">
                  {selected.contact.phone} · {selected.agent ? `agente ${selected.agent.name}` : selected.instance!.name}
                </div>
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
                onClick={handleRefresh}
                disabled={refreshing}
                title="Buscar mensagens novas"
                aria-label="Buscar mensagens novas"
                className="grid place-items-center w-8 h-8 rounded-md shrink-0 cursor-pointer border border-border text-text-muted disabled:opacity-60"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                  className={refreshing ? "animate-spin" : ""}
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => handleClearHistory(selected.contact.id, selected.agent?.id ?? null)}
                disabled={pending}
                title={selected.agent ? "Apaga o histórico dessa conversa (o agente esquece tudo)" : "Apaga o histórico dessa conversa"}
                className="text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer border border-border text-text-muted disabled:opacity-60"
              >
                Limpar conversa
              </button>
              {selected.agent && (
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
              )}
            </div>

            {selected.agent && selected.contact.needs_attention && (
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

            <div className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 flex flex-col gap-2.5 bg-bg/40">
              {orderedMessages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
                    m.role === "user" ? "bg-surface border border-border self-start" : "bg-primary-soft text-primary-strong self-end"
                  }`}
                >
                  {m.media_url && m.media_type && <MediaAttachment url={m.media_url} type={m.media_type} />}
                  {!MEDIA_ONLY_PLACEHOLDER.test(m.content) && m.content}
                  <div className={`text-xs mt-1.5 ${m.role === "user" ? "text-text-muted" : "text-primary-strong/70"}`}>{formatTime(m.created_at)}</div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 p-4 border-t border-border"
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileInputChange}
                accept="image/*,audio/*,application/pdf"
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={composerLocked || recording}
                title="Anexar arquivo"
                aria-label="Anexar arquivo"
                className="grid place-items-center w-9 h-9 rounded-full shrink-0 text-text-muted hover:text-text hover:bg-bg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M21.44 11.05 12.25 20.24a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.6-2.6l8.49-8.48" />
                </svg>
              </button>
              <button
                type="button"
                onClick={handleToggleRecording}
                disabled={composerLocked}
                title={recording ? "Parar e enviar gravação" : "Gravar áudio"}
                aria-label={recording ? "Parar e enviar gravação" : "Gravar áudio"}
                className={`grid place-items-center w-9 h-9 rounded-full shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  recording ? "bg-danger text-white animate-pulse" : "text-text-muted hover:text-text hover:bg-bg"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" />
                  <line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={composerLocked}
                placeholder={!selected.agent || selected.contact.needs_attention ? "Escreva a mensagem…" : "Assuma a conversa pra escrever manualmente"}
                className="flex-1 border border-border rounded-full px-4 py-2.5 text-[15px] outline-none focus:border-primary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={composerLocked || !draft.trim()}
                className="bg-primary-strong text-white text-sm font-bold px-5 py-2.5 rounded-full cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
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
  return c.agent ? `${c.contact.id}:agent:${c.agent.id}` : `${c.contact.id}:instance`;
}
