"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
  prepareManualUpload,
} from "@/app/actions/conversations";
import { createClient as createBrowserSupabase } from "@/lib/supabase/client";
import { updateContactResponsible, updateContactStage } from "@/app/actions/contacts";
import { setConversationStatus, setConversationResponsible } from "@/app/actions/conversation-tickets";
import type { TicketStatus } from "@/lib/conversation-tickets";
import { CrmLeadDrawer } from "@/components/crm-lead-drawer";
import { VoiceInput } from "@/components/ui/voice-input";
import { VoiceMessageBubble } from "@/components/ui/voice-message-bubble";
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { listPipelines, moveContactToStage, type PipelineWithStages } from "@/app/actions/pipelines";
import { sortStages, stageForSignal } from "@/lib/pipelines";
import type { WhatsappChannel } from "@/lib/whatsapp-channel";
import { CONVERSATION_MEDIA_ACCEPT, resolveFileMime } from "@/lib/conversation-media";
import { mp4OpusToOgg } from "@/lib/audio-remux";

// Mesmo teto do servidor (prepareManualUpload) — checado antes pra não subir um arquivo grande à toa.
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

const TICKET_STATUS_LABELS: Record<TicketStatus, string> = { aberto: "Aberto", pendente: "Pendente", resolvido: "Resolvido" };
const TICKET_STATUS_BADGE: Record<TicketStatus, string> = {
  aberto: "bg-bg text-text-muted",
  pendente: "bg-warning-soft text-warning-text",
  resolvido: "bg-success-soft text-success",
};

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

// Quantas conversas a lista desenha de início e a cada "Ver mais". A busca e os filtros olham todas;
// isto só limita o que vai pra tela.
const LIST_PAGE_FIRST = 80;
const LIST_PAGE_MORE = 50;

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
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  responsible_user_id: string | null;
  origin_campaign: string | null;
};
type Agent = { id: string; name: string; photo_url: string | null; evolution_instance_name: string };
// Conversa de número sem agente de IA (disparo avulso) — "name" já vem traduzido (Vendas/Financeiro).
type Instance = { id: string; name: string; channel: WhatsappChannel };
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
export type Conversation = {
  contact: Contact;
  agent: Agent | null;
  instance: Instance | null;
  messages: Message[];
  ticket_status: TicketStatus;
  ticket_responsible_user_id: string | null;
};

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

// Fuso fixo: a página também é renderizada no servidor (UTC na Vercel), e sem isso a hora e o "dia" de
// uma mensagem perto da meia-noite saíam diferentes no servidor e no navegador.
const TZ = "America/Sao_Paulo";

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

// Chave do dia civil (AAAA-MM-DD) no fuso de Brasília — é o que decide onde entra o separador de data.
function dayKey(date: Date) {
  return date.toLocaleDateString("en-CA", { timeZone: TZ });
}

// Diferença em dias de calendário entre hoje e a data (0 = hoje, 1 = ontem).
function daysAgo(iso: string) {
  const [y1, m1, d1] = dayKey(new Date()).split("-").map(Number);
  const [y2, m2, d2] = dayKey(new Date(iso)).split("-").map(Number);
  return Math.round((Date.UTC(y1, m1 - 1, d1) - Date.UTC(y2, m2 - 1, d2)) / 86_400_000);
}

// Separador no meio da conversa, no estilo do WhatsApp: Hoje / Ontem / dia da semana / data completa.
function formatDaySeparator(iso: string) {
  const diff = daysAgo(iso);
  if (diff === 0) return "Hoje";
  if (diff === 1) return "Ontem";
  const d = new Date(iso);
  if (diff > 1 && diff < 7) {
    const weekday = d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: TZ });
    return weekday.charAt(0).toUpperCase() + weekday.slice(1);
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric", timeZone: TZ });
}

// Horário da última mensagem na lista de conversas: hora se foi hoje, senão o dia (como no WhatsApp) —
// só a hora fazia uma conversa de semana passada parecer de agora há pouco.
function formatListTime(iso: string) {
  const diff = daysAgo(iso);
  if (diff === 0) return formatTime(iso);
  if (diff === 1) return "Ontem";
  const d = new Date(iso);
  if (diff > 1 && diff < 7) return d.toLocaleDateString("pt-BR", { weekday: "short", timeZone: TZ }).replace(".", "");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: TZ });
}

// Placeholders sintéticos que o backend grava quando não há texto de verdade pra acompanhar a mídia
// (foto sem legenda) — não faz sentido mostrar esse texto técnico junto do preview visual.
const MEDIA_ONLY_PLACEHOLDER = /^\[(o cliente enviou uma foto|arquivo enviado: .*)\]$/;

function MediaAttachment({ url, type, tone }: { url: string; type: "image" | "audio" | "document"; tone: "in" | "out" }) {
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mb-1.5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt="Imagem da conversa" className="max-w-full max-h-64 rounded-lg border border-border object-cover" />
      </a>
    );
  }
  if (type === "audio") {
    return <VoiceMessageBubble audioSrc={url} tone={tone} />;
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
  conversations: serverConversations,
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

  // Mensagens que a equipe acabou de mandar: aparecem na hora, sem esperar a página inteira recarregar do
  // servidor. Saem daqui quando os dados novos chegam (o servidor já tem a mensagem de verdade).
  const [sentLocal, setSentLocal] = useState<Message[]>([]);
  useEffect(() => {
    setSentLocal([]);
  }, [serverConversations]);
  const conversations = useMemo(
    () =>
      sentLocal.length === 0
        ? serverConversations
        : serverConversations.map((c) => {
            const extra = sentLocal.filter((m) => m.contact_id === c.contact.id && m.agent_id === (c.agent?.id ?? null));
            return extra.length ? { ...c, messages: [...extra.slice().reverse(), ...c.messages] } : c;
          }),
    [serverConversations, sentLocal]
  );
  function showSentNow(contactId: string, agentId: string | null, content: string) {
    setSentLocal((cur) => [
      ...cur,
      { id: `local-${Date.now()}-${cur.length}`, contact_id: contactId, agent_id: agentId, role: "assistant", content, media_url: null, media_type: null, created_at: new Date().toISOString() },
    ]);
    router.refresh();
  }
  const searchParams = useSearchParams();
  const contactParam = searchParams.get("contact");
  const [refreshing, startRefresh] = useTransition();

  function handleRefresh() {
    startRefresh(() => router.refresh());
  }

  // Funis do workspace: as etapas aqui são as mesmas do CRM (nome e ordem do funil de cada lead). Sem
  // funil configurado, cai nas 7 fases padrão.
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  useEffect(() => {
    listPipelines().then(setPipelines).catch(() => setPipelines([]));
  }, []);

  // Lead sem funil pertence ao padrão, posicionado pelo sinal — mesma regra do Kanban e da ficha.
  function pipelineOf(c: Contact) {
    return pipelines.find((p) => p.id === c.pipeline_id) ?? pipelines.find((p) => p.is_default) ?? pipelines[0] ?? null;
  }
  function pipelineStageOf(c: Contact) {
    const pl = pipelineOf(c);
    if (!pl || pl.stages.length === 0) return null;
    const stages = sortStages(pl.stages);
    return stages.find((st) => st.id === c.pipeline_stage_id) ?? stageForSignal(c.stage as ContactStage, stages);
  }
  function stageNameOf(c: Contact) {
    return pipelineStageOf(c)?.name ?? (stageLabels[c.stage] || c.stage);
  }
  // Chave do filtro: id da etapa do funil (ou o sinal, quando não há funil).
  function stageKeyOf(c: Contact) {
    return pipelineStageOf(c)?.id ?? c.stage;
  }
  const stageChips = pipelines.some((p) => p.stages.length > 0)
    ? pipelines.flatMap((p) =>
        sortStages(p.stages).map((st) => ({ key: st.id, label: pipelines.length > 1 ? `${p.name} · ${st.name}` : st.name }))
      )
    : visibleStages.map((s) => ({ key: s, label: stageLabels[s] || s }));

  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Várias etapas ao mesmo tempo (ex.: Abordado + Interessado). Vazio = todas.
  const [stageFilters, setStageFilters] = useState<string[]>([]);
  const [aguardandoHumano, setAguardandoHumano] = useState(false);
  const [semResposta, setSemResposta] = useState(false);
  const [waitFilter, setWaitFilter] = useState("");
  const [campaignFilter, setCampaignFilter] = useState("");
  const [responsavelFilter, setResponsavelFilter] = useState("");
  const [ticketFilter, setTicketFilter] = useState<TicketStatus | "">("");

  // Vindo do CRM (?contact=<id>), abre direto a conversa dessa pessoa; senão, a mais recente.
  // Pedido um contato que não tem conversa, NÃO cai na primeira da lista: abrir a conversa de outra
  // pessoa quando se clicou num lead específico é pior que não abrir nada — quem está atendendo lê o
  // histórico achando que é do lead que clicou.
  const [selectedKey, setSelectedKey] = useState<string | null>(() => {
    if (contactParam) {
      const found = conversations.find((c) => c.contact.id === contactParam);
      return found ? keyOf(found) : null;
    }
    return conversations[0] ? keyOf(conversations[0]) : null;
  });
  const leadSemConversa = Boolean(contactParam) && !conversations.some((c) => c.contact.id === contactParam);
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
      if (stageFilters.length > 0 && !stageFilters.includes(stageKeyOf(c.contact))) return false;
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
      if (ticketFilter && c.ticket_status !== ticketFilter) return false;
      return true;
    });
  }, [conversations, pipelines, query, stageFilters, aguardandoHumano, semResposta, waitFilter, campaignFilter, responsavelFilter, ticketFilter]);

  // Só uma parte da lista vai pra tela (milhares de linhas travam o navegador). Qualquer mudança de
  // filtro/busca volta pro tamanho inicial, sem precisar de efeito: o limite guarda a "assinatura"
  // dos filtros em que foi ampliado e só vale enquanto ela for a mesma.
  const filterSig = [query, stageFilters.join(","), aguardandoHumano, semResposta, waitFilter, campaignFilter, responsavelFilter, ticketFilter].join("|");
  const [expanded, setExpanded] = useState<{ sig: string; limit: number }>({ sig: "", limit: LIST_PAGE_FIRST });
  const listLimit = expanded.sig === filterSig ? expanded.limit : LIST_PAGE_FIRST;
  const shown = filtered.slice(0, listLimit);

  const activeFilterCount =
    (stageFilters.length > 0 ? 1 : 0) +
    (aguardandoHumano ? 1 : 0) +
    (semResposta ? 1 : 0) +
    (waitFilter ? 1 : 0) +
    (campaignFilter ? 1 : 0) +
    (responsavelFilter ? 1 : 0) +
    (ticketFilter ? 1 : 0);

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

  function handleTicketStatus(contactId: string, agentId: string | null, status: TicketStatus) {
    startTransition(async () => {
      await setConversationStatus(contactId, agentId, status);
    });
  }

  function handleTicketResponsible(contactId: string, agentId: string | null, userId: string) {
    startTransition(async () => {
      await setConversationResponsible(contactId, agentId, userId || null);
    });
  }

  function handleStageChange(contactId: string, stage: string) {
    setError(null);
    startTransition(async () => {
      const result = await updateContactStage(contactId, stage);
      if (result.error) setError(result.error);
    });
  }

  function handlePipelineStageChange(contactId: string, stageId: string) {
    setError(null);
    startTransition(async () => {
      const result = await moveContactToStage(contactId, stageId);
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
      else {
        setDraft("");
        showSentNow(selected.contact.id, selected.agent?.id ?? null, text);
      }
    });
  }

  // O arquivo sobe direto do navegador pro Storage (URL assinada) e o servidor só recebe o caminho —
  // passar os bytes pelo server action estourava o teto de ~4,5MB da Vercel e derrubava a tela.
  function handleSendFile(file: File) {
    if (!selected) return;
    setError(null);
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError("Arquivo maior que 50MB.");
      return;
    }
    startTransition(async () => {
      try {
        const mime = resolveFileMime(file.name, file.type);
        const prep = await prepareManualUpload(selected.contact.id, file.name, mime, file.size);
        if (prep.error || !prep.path || !prep.token) {
          setError(prep.error || "Não foi possível preparar o envio do arquivo.");
          return;
        }
        const { error: uploadError } = await createBrowserSupabase()
          .storage.from("conversation-media")
          .uploadToSignedUrl(prep.path, prep.token, file, { contentType: mime });
        if (uploadError) {
          setError(`Falha ao subir o arquivo: ${uploadError.message}`);
          return;
        }
        const upload = { path: prep.path, fileName: file.name, mimeType: mime, size: file.size };
        const result = selected.agent
          ? await sendManualMedia(selected.contact.id, selected.agent.id, upload)
          : await sendInstanceMedia(selected.contact.id, selected.instance!.id, upload);
        if (result.error) setError(result.error);
        else showSentNow(selected.contact.id, selected.agent?.id ?? null, `[arquivo enviado: ${file.name}]`);
      } catch {
        // Queda de rede ou resposta inesperada do servidor: mostra o erro no composer em vez de
        // deixar a exceção subir e trocar a tela inteira pela página de erro.
        setError("Não foi possível enviar o arquivo. Verifique a conexão e tente de novo.");
      }
    });
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite escolher o mesmo arquivo de novo depois
    if (file) handleSendFile(file);
  }

  // Parar pode ser chamado mais de uma vez (clique + efeito do componente); por isso checa o estado antes.
  function stopRecording() {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setRecording(false);
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // WhatsApp não aceita webm como áudio (só ogg/opus, mp4/aac, mpeg e amr). Por isso tenta primeiro
      // os formatos aceitos; webm só se o navegador não gravar nenhum deles.
      const preferred = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus"].find((t) => MediaRecorder.isTypeSupported(t));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const mimeType = recorder.mimeType || "audio/webm";
        const blob = new Blob(recordedChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        if (mimeType.includes("webm")) {
          setError("Esse navegador grava áudio num formato que o WhatsApp não aceita. Atualize o Chrome ou grave pelo Edge/Firefox.");
          return;
        }
        // O Chrome grava Opus dentro de MP4, que a WhatsApp não processa (a Meta aceita o envio e o áudio nunca
        // chega). Troca o envelope pra Ogg/Opus, que ela aceita e mostra como mensagem de voz. AAC (Safari) segue igual.
        if (mimeType.includes("mp4")) {
          const ogg = mp4OpusToOgg(new Uint8Array(await blob.arrayBuffer()));
          if (ogg) {
            handleSendFile(new File([ogg as BlobPart], `audio-${Date.now()}.ogg`, { type: "audio/ogg" }));
            return;
          }
        }
        const ext = mimeType.includes("mp4") ? "m4a" : "ogg";
        handleSendFile(new File([blob], `audio-${Date.now()}.${ext}`, { type: mimeType }));
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      // Cada causa tem um conserto diferente, então a mensagem diz qual é (o nome do erro do navegador).
      const name = err instanceof DOMException ? err.name : "";
      if (!window.isSecureContext || !navigator.mediaDevices) {
        setError("O navegador bloqueou o microfone porque a página não está em HTTPS. Abra o painel pelo endereço seguro.");
      } else if (name === "NotAllowedError" || name === "SecurityError") {
        setError("Permissão do microfone negada. Clique no cadeado ao lado do endereço, libere o microfone pra este site e tente de novo. Se continuar, verifique em Configurações do Windows > Privacidade > Microfone se o navegador está liberado.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("Nenhum microfone encontrado. Conecte um microfone ou escolha outro dispositivo nas configurações de som do Windows.");
      } else if (name === "NotReadableError") {
        setError("O microfone está em uso por outro programa (ex.: Teams, Zoom ou outra aba). Feche-o e tente de novo.");
      } else {
        setError(`Não foi possível iniciar a gravação${name ? ` (${name})` : ""}. Tente de novo.`);
      }
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
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-text-muted">Etapa (pode marcar mais de uma)</span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {stageChips.map(({ key: s, label }) => {
                    const on = stageFilters.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setStageFilters((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}
                        className={`text-[11px] font-bold px-2.5 py-1 rounded-full cursor-pointer border transition-colors ${
                          on ? "border-primary-strong bg-primary-strong text-white" : "border-border text-text-muted hover:border-primary-soft"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>

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

              <select value={ticketFilter} onChange={(e) => setTicketFilter(e.target.value as TicketStatus | "")} className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary cursor-pointer bg-surface">
                <option value="">Status do atendimento: todos</option>
                {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((s) => (
                  <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
                ))}
              </select>

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
                      setStageFilters([]);
                      setAguardandoHumano(false);
                      setSemResposta(false);
                      setWaitFilter("");
                      setCampaignFilter("");
                      setResponsavelFilter("");
                      setTicketFilter("");
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
            shown.map((c) => {
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
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 max-w-[110px] truncate ${STAGE_BADGE[c.contact.stage] || STAGE_BADGE.nao_abordado}`}
                      >
                        {stageNameOf(c.contact)}
                      </span>
                      <span
                        title="Status do atendimento"
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${TICKET_STATUS_BADGE[c.ticket_status]}`}
                      >
                        {TICKET_STATUS_LABELS[c.ticket_status]}
                      </span>
                      {last && <time className="text-xs text-text-muted shrink-0" dateTime={last.created_at}>{formatListTime(last.created_at)}</time>}
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
          {filtered.length > shown.length && (
            <div className="p-3 flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => setExpanded({ sig: filterSig, limit: listLimit + LIST_PAGE_MORE })}
                className="text-xs font-bold px-4 py-2 rounded-md border border-border text-primary-strong hover:border-primary-soft cursor-pointer"
              >
                Ver mais {Math.min(LIST_PAGE_MORE, filtered.length - shown.length)}
              </button>
              <span className="text-[11px] text-text-muted">
                Mostrando {shown.length} de {filtered.length}
              </span>
            </div>
          )}
        </div>
      </div>

      <div className={`flex-col min-h-0 ${mobileView === "list" ? "hidden md:flex" : "flex"}`}>
        {!selected ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm px-6 text-center">
            {leadSemConversa
              ? "Esse lead ainda não tem mensagens trocadas — nada pra mostrar aqui."
              : "Selecione uma conversa"}
          </div>
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
              <div className="min-w-0 flex-1 basis-40 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setDrawerContactId(selected.contact.id)}
                  title="Ver detalhes do lead"
                  className="block max-w-full text-base font-bold truncate hover:underline cursor-pointer text-left"
                >
                  {selected.contact.name || selected.contact.phone}
                </button>
                <div className="text-sm text-text-muted truncate mt-0.5">
                  {selected.contact.phone} · {selected.agent ? `agente ${selected.agent.name}` : selected.instance!.name}
                </div>
              </div>

              {pipelineStageOf(selected.contact) ? (
                <select
                  value={pipelineStageOf(selected.contact)!.id}
                  onChange={(e) => handlePipelineStageChange(selected.contact.id, e.target.value)}
                  disabled={pending}
                  title="Etapa do funil"
                  className={`text-xs font-bold px-2.5 py-2 rounded-md shrink-0 max-w-[170px] cursor-pointer border-none outline-none disabled:opacity-60 ${STAGE_BADGE[selected.contact.stage] || STAGE_BADGE.nao_abordado}`}
                >
                  {sortStages(pipelineOf(selected.contact)!.stages).map((st) => (
                    <option key={st.id} value={st.id}>{st.name}</option>
                  ))}
                </select>
              ) : (
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
              )}

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

              <select
                value={selected.ticket_status}
                onChange={(e) => handleTicketStatus(selected.contact.id, selected.agent?.id ?? null, e.target.value as TicketStatus)}
                disabled={pending}
                title="Status do atendimento"
                className={`text-xs font-bold px-2.5 py-2 rounded-md shrink-0 cursor-pointer border-none outline-none disabled:opacity-60 ${TICKET_STATUS_BADGE[selected.ticket_status]}`}
              >
                {(Object.keys(TICKET_STATUS_LABELS) as TicketStatus[]).map((s) => (
                  <option key={s} value={s}>{TICKET_STATUS_LABELS[s]}</option>
                ))}
              </select>

              {vendors.length > 0 && (
                <select
                  value={selected.ticket_responsible_user_id || ""}
                  onChange={(e) => handleTicketResponsible(selected.contact.id, selected.agent?.id ?? null, e.target.value)}
                  disabled={pending}
                  title="Responsável por esse atendimento"
                  className="text-xs font-bold px-2.5 py-2 rounded-md shrink-0 cursor-pointer border border-border text-text-muted disabled:opacity-60 outline-none focus:border-primary bg-surface"
                >
                  <option value="">Atendimento sem responsável</option>
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
              {orderedMessages.map((m, i) => {
                const newDay = i === 0 || dayKey(new Date(m.created_at)) !== dayKey(new Date(orderedMessages[i - 1].created_at));
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <div className="self-center my-1.5 text-xs font-semibold text-text-muted bg-surface border border-border rounded-full px-3 py-1 shadow-sm">
                        {formatDaySeparator(m.created_at)}
                      </div>
                    )}
                    <div
                      className={`max-w-[75%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed shadow-sm ${
                        m.role === "user" ? "bg-surface border border-border self-start" : "bg-primary-soft text-primary-strong self-end"
                      }`}
                    >
                      {m.media_url && m.media_type && <MediaAttachment url={m.media_url} type={m.media_type} tone={m.role === "user" ? "in" : "out"} />}
                      {!MEDIA_ONLY_PLACEHOLDER.test(m.content) && m.content}
                      <div className={`text-xs mt-1.5 ${m.role === "user" ? "text-text-muted" : "text-primary-strong/70"}`}>{formatTime(m.created_at)}</div>
                    </div>
                  </Fragment>
                );
              })}
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
                accept={`image/*,audio/*,${CONVERSATION_MEDIA_ACCEPT},.csv,.xls,.xlsx,.doc,.docx,.ppt,.pptx,.txt`}
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
              <VoiceInput listening={recording} disabled={composerLocked} onStart={startRecording} onStop={stopRecording} />
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
