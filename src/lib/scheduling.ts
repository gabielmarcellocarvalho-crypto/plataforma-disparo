import { randomUUID } from "crypto";
import type { createAdminClient } from "@/lib/supabase/admin";
import { normalizeAgentConfig, type SchedulingConfig } from "@/lib/agent-prompt";
import { canAdvanceStage, type ContactStage } from "@/lib/crm-stages";
import { formatFieldValue, type CustomFieldDef } from "@/lib/custom-fields";
import { getAccessToken } from "@/lib/calendar/connections";
import { CalendarAuthError } from "@/lib/calendar/google-oauth";
import { deleteEvent, getEvent, insertEvent, listEvents, patchEvent, SlotTakenError, type GoogleEvent } from "@/lib/calendar/google-events";
import { isSlotTitle, pickSlots, type Slot } from "@/lib/calendar/slots";
import { pickCloser, type CloserCandidate } from "@/lib/calendar/closer";

// Motor do agendamento: junta config do agente, banco e Google Agenda. As ferramentas do agente
// (agent-turn.ts) só chamam as 4 funções exportadas no fim e repassam o texto pro modelo.
//
// Regra de ouro: o agente nunca confirma horário que não foi gravado no Google. Qualquer falha vira
// texto de erro pra ferramenta, e o modelo é instruído a dizer que o time confirma depois.

type AdminClient = ReturnType<typeof createAdminClient>;

type AgentLike = { id: string; workspace_id: string; config: unknown };
type ContactLike = { id: string; name: string | null; phone: string | null; email?: string | null; stage: string; team_member_id?: string | null; custom_fields?: Record<string, unknown> | null };

const TZ = "America/Sao_Paulo";
const ACTIVE_STATUSES = ["marcada", "remarcada"];
// Link da conversa na descrição do evento. O agente roda no webhook, sem origem de requisição.
const APP_URL = process.env.APP_URL || "https://plataforma.disparo.studiov4carvalho.com.br";

export type ActiveMeeting = { id: string; team_member_id: string; google_event_id: string; starts_at: string; ends_at: string; meet_link: string | null };

export type SchedulingContext = {
  config: SchedulingConfig;
  // Closers da lista do agente com agenda conectada.
  connectedCloserIds: string[];
  activeMeeting: ActiveMeeting | null;
};

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "long", timeZone: TZ });
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return `${weekday}, ${date} às ${time}`;
}

// null = agendamento não se aplica a esse agente agora (desligado, sem closer ou nenhum conectado) —
// nesse caso o agente nem recebe as ferramentas e segue como sempre foi.
export async function getSchedulingContext(admin: AdminClient, agent: AgentLike, contactId: string): Promise<SchedulingContext | null> {
  const config = normalizeAgentConfig(agent.config).scheduling;
  if (!config.enabled || config.closerIds.length === 0) return null;

  const [{ data: conns }, { data: meeting }] = await Promise.all([
    admin.from("calendar_connections").select("team_member_id").eq("workspace_id", agent.workspace_id).eq("status", "conectado").in("team_member_id", config.closerIds),
    admin
      .from("meetings")
      .select("id, team_member_id, google_event_id, starts_at, ends_at, meet_link")
      .eq("contact_id", contactId)
      .in("status", ACTIVE_STATUSES)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const connectedCloserIds = (conns || []).map((c) => c.team_member_id as string);
  const activeMeeting = (meeting as ActiveMeeting | null) ?? null;
  if (connectedCloserIds.length === 0 && !activeMeeting) return null;
  return { config, connectedCloserIds, activeMeeting };
}

// ── Opção de horário ────────────────────────────────────────────────────────
// O modelo recebe um id opaco por opção ("closer:evento"). Assim a marcação sabe em qual agenda
// escrever sem depender de o modelo lembrar de passar o closer certo.

function optionId(closerId: string, eventId: string): string {
  return `${closerId}:${eventId}`;
}
function parseOptionId(raw: string): { closerId: string; eventId: string } | null {
  const i = raw.indexOf(":");
  if (i <= 0 || i === raw.length - 1) return null;
  return { closerId: raw.slice(0, i), eventId: raw.slice(i + 1) };
}

async function slotsFor(admin: AdminClient, closerId: string, config: SchedulingConfig): Promise<Slot[]> {
  const token = await getAccessToken(admin, closerId);
  const now = new Date();
  const events = await listEvents(token, now, new Date(now.getTime() + config.daysAhead * 86_400_000), config.slotTitle);
  return pickSlots(events, { slotTitle: config.slotTitle, minNoticeHours: config.minNoticeHours, daysAhead: config.daysAhead, now });
}

// Escolhe o closer (dono → rodízio) e já traz os horários dele. Closer sem "Marque aqui" livre sai
// da disputa e a escolha roda de novo — só consulta o Google de quem pode ser escolhido.
async function chooseCloserWithSlots(
  admin: AdminClient,
  ctx: SchedulingContext,
  contact: ContactLike
): Promise<{ closerId: string; slots: Slot[] } | null> {
  if (ctx.activeMeeting) {
    const slots = await slotsFor(admin, ctx.activeMeeting.team_member_id, ctx.config);
    return { closerId: ctx.activeMeeting.team_member_id, slots };
  }

  const { data: last } = await admin
    .from("meetings")
    .select("team_member_id, created_at")
    .in("team_member_id", ctx.connectedCloserIds)
    .order("created_at", { ascending: false })
    .limit(200);
  const lastByCloser = new Map<string, string>();
  for (const m of last || []) if (!lastByCloser.has(m.team_member_id as string)) lastByCloser.set(m.team_member_id as string, m.created_at as string);

  const candidates: CloserCandidate[] = ctx.connectedCloserIds.map((id) => ({ id, connected: true, hasSlots: true, lastMeetingAt: lastByCloser.get(id) ?? null }));
  for (let i = 0; i < candidates.length; i++) {
    const closerId = pickCloser({ closerIds: ctx.config.closerIds, ownerId: contact.team_member_id ?? null, activeMeetingCloserId: null, candidates });
    if (!closerId) return null;
    try {
      const slots = await slotsFor(admin, closerId, ctx.config);
      if (slots.length > 0) return { closerId, slots };
    } catch (err) {
      // Autorização quebrada já foi marcada como "reconectar" em getAccessToken; segue pro próximo.
      if (!(err instanceof CalendarAuthError)) throw err;
    }
    candidates.find((c) => c.id === closerId)!.hasSlots = false;
  }
  return null;
}

async function closerName(admin: AdminClient, closerId: string): Promise<string> {
  const { data } = await admin.from("team_members").select("name").eq("id", closerId).maybeSingle();
  return (data?.name as string) || "nosso time";
}

export async function offerSlots(admin: AdminClient, ctx: SchedulingContext, contact: ContactLike): Promise<string> {
  const chosen = await chooseCloserWithSlots(admin, ctx, contact);
  if (!chosen || chosen.slots.length === 0) {
    return "SEM_HORARIOS: não há horário disponível nos próximos dias. Diga ao cliente que o time vai confirmar um horário com ele em breve (não invente horário) e sinalize internamente com [[PRECISA_HUMANO]].";
  }
  const name = await closerName(admin, chosen.closerId);
  const lines = chosen.slots.map((s) => `- opcao_id=${optionId(chosen.closerId, s.eventId)} → ${formatWhen(s.start)}`);
  return [
    `Horários disponíveis com ${name} (horário de Brasília). Ofereça ao cliente em texto natural, sem mostrar os ids:`,
    ...lines,
    "Quando o cliente escolher, confirme e chame marcar_reuniao com o opcao_id correspondente.",
  ].join("\n");
}

async function eventDescription(admin: AdminClient, workspaceId: string, contact: ContactLike): Promise<string> {
  const { data: defs } = await admin.from("custom_field_defs").select("key, label, type").eq("workspace_id", workspaceId);
  const labelOf = new Map((defs || []).map((d) => [d.key as string, d as Pick<CustomFieldDef, "key" | "label" | "type">]));
  const fields = Object.entries(contact.custom_fields || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => {
      const def = labelOf.get(k);
      return `• ${def?.label ?? k}: ${def ? formatFieldValue(def, v) : String(v)}`;
    });
  return [
    `Lead: ${contact.name || "sem nome"}`,
    contact.phone ? `WhatsApp: +${contact.phone}` : null,
    fields.length ? `\nO que o SDR levantou:\n${fields.join("\n")}` : null,
    `\nConversa completa: ${APP_URL}/conversas?contact=${contact.id}`,
  ]
    .filter(Boolean)
    .join("\n");
}

// Transforma o "Marque aqui" na reunião. Relê o evento antes: se já não é mais "Marque aqui", alguém
// pegou; o PATCH ainda vai com If-Match pra fechar a janela entre a leitura e a escrita.
async function claimSlot(
  admin: AdminClient,
  token: string,
  eventId: string,
  config: SchedulingConfig,
  workspaceId: string,
  contact: ContactLike,
  email: string | null
): Promise<GoogleEvent> {
  const current = await getEvent(token, eventId);
  if (current.status === "cancelled" || !isSlotTitle(current.summary, config.slotTitle)) throw new SlotTakenError("Horário já ocupado.");
  return patchEvent(
    token,
    eventId,
    {
      summary: `Reunião: ${contact.name || contact.phone || "lead"}`,
      description: await eventDescription(admin, workspaceId, contact),
      ...(email ? { attendees: [{ email }] } : {}),
      conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
    },
    current.etag
  );
}

// Devolve a reunião a "Marque aqui" (remarcar/cancelar). Se o Google não aceitar tirar o Meet do
// evento, apaga e recria um "Marque aqui" limpo no mesmo horário — pra agenda do closer o efeito é o mesmo.
async function releaseSlot(token: string, eventId: string, slotTitle: string): Promise<void> {
  try {
    await patchEvent(token, eventId, { summary: slotTitle, description: "", attendees: [], conferenceData: null });
  } catch (err) {
    if (err instanceof CalendarAuthError) throw err;
    const ev = await getEvent(token, eventId);
    await deleteEvent(token, eventId);
    await insertEvent(token, { summary: slotTitle, start: ev.start, end: ev.end });
  }
}

async function note(admin: AdminClient, workspaceId: string, contactId: string, content: string) {
  await admin.from("contact_notes").insert({ contact_id: contactId, workspace_id: workspaceId, author_name: "Agendamento automático", content });
}

function slotTakenText(): string {
  return "OCUPADO: esse horário acabou de ser ocupado. Peça desculpas rapidamente e chame ver_horarios_disponiveis de novo pra oferecer outras opções.";
}

export async function bookMeeting(
  admin: AdminClient,
  ctx: SchedulingContext,
  agent: AgentLike,
  contact: ContactLike,
  rawOption: string,
  rawEmail: string | null
): Promise<string> {
  const opt = parseOptionId(rawOption);
  if (!opt || !ctx.config.closerIds.includes(opt.closerId)) return "ERRO: opcao_id inválido. Chame ver_horarios_disponiveis e use um dos ids devolvidos.";
  // Já tem reunião: marcar outra é remarcar.
  if (ctx.activeMeeting) return rescheduleMeeting(admin, ctx, agent, contact, rawOption);

  const email = rawEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail.trim()) ? rawEmail.trim() : null;
  const token = await getAccessToken(admin, opt.closerId);
  let ev: GoogleEvent;
  try {
    ev = await claimSlot(admin, token, opt.eventId, ctx.config, agent.workspace_id, contact, email);
  } catch (err) {
    if (err instanceof SlotTakenError) return slotTakenText();
    throw err;
  }

  const startsAt = ev.start?.dateTime as string;
  const endsAt = ev.end?.dateTime as string;
  await admin.from("meetings").insert({
    workspace_id: agent.workspace_id,
    contact_id: contact.id,
    agent_id: agent.id,
    team_member_id: opt.closerId,
    google_event_id: opt.eventId,
    starts_at: startsAt,
    ends_at: endsAt,
    meet_link: ev.hangoutLink ?? null,
    status: "marcada",
  });

  const updates: Record<string, unknown> = {};
  const stage = contact.stage as ContactStage;
  if (canAdvanceStage(stage, "encaminhamento") && stage !== "concluido" && stage !== "descartado") {
    updates.stage = "encaminhamento";
    updates.stage_changed_at = new Date().toISOString();
  }
  // Lead sem dono passa a ser do closer que recebeu a reunião. Lead com dono nunca é reatribuído.
  if (!contact.team_member_id) updates.team_member_id = opt.closerId;
  if (email && !contact.email) updates.email = email;
  if (Object.keys(updates).length) await admin.from("contacts").update(updates).eq("id", contact.id);

  const name = await closerName(admin, opt.closerId);
  await note(admin, agent.workspace_id, contact.id, `Reunião marcada com ${name}: ${formatWhen(startsAt)}.`);

  return [
    `MARCADA com ${name}: ${formatWhen(startsAt)} (horário de Brasília).`,
    ev.hangoutLink ? `Link do Meet: ${ev.hangoutLink}` : "O link do Meet vai no convite da agenda.",
    email ? "O convite também foi enviado pro e-mail do cliente." : null,
    "Confirme ao cliente o dia, a hora e o link. A partir de agora trate só de assuntos dessa reunião.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function rescheduleMeeting(admin: AdminClient, ctx: SchedulingContext, agent: AgentLike, contact: ContactLike, rawOption: string): Promise<string> {
  const current = ctx.activeMeeting;
  if (!current) return "ERRO: o cliente não tem reunião marcada. Use marcar_reuniao.";
  const opt = parseOptionId(rawOption);
  if (!opt || opt.closerId !== current.team_member_id) return "ERRO: opcao_id inválido. Chame ver_horarios_disponiveis e use um dos ids devolvidos.";

  const token = await getAccessToken(admin, current.team_member_id);
  const old = await getEvent(token, current.google_event_id).catch(() => null);
  const email = old?.attendees?.[0]?.email ?? null;

  // Marca o novo ANTES de soltar o antigo: se o novo falhar, o cliente continua com a reunião que tinha.
  let ev: GoogleEvent;
  try {
    ev = await claimSlot(admin, token, opt.eventId, ctx.config, agent.workspace_id, contact, email);
  } catch (err) {
    if (err instanceof SlotTakenError) return slotTakenText();
    throw err;
  }
  await releaseSlot(token, current.google_event_id, ctx.config.slotTitle);

  const startsAt = ev.start?.dateTime as string;
  await admin
    .from("meetings")
    .update({ google_event_id: opt.eventId, starts_at: startsAt, ends_at: ev.end?.dateTime, meet_link: ev.hangoutLink ?? null, status: "remarcada", updated_at: new Date().toISOString() })
    .eq("id", current.id);
  const name = await closerName(admin, current.team_member_id);
  await note(admin, agent.workspace_id, contact.id, `Reunião remarcada com ${name}: ${formatWhen(startsAt)} (antes: ${formatWhen(current.starts_at)}).`);

  return [
    `REMARCADA com ${name}: ${formatWhen(startsAt)} (horário de Brasília).`,
    ev.hangoutLink ? `Link do Meet: ${ev.hangoutLink}` : null,
    "Confirme ao cliente o novo dia, hora e link.",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function cancelMeeting(admin: AdminClient, ctx: SchedulingContext, agent: AgentLike, contact: ContactLike): Promise<string> {
  const current = ctx.activeMeeting;
  if (!current) return "ERRO: o cliente não tem reunião marcada.";
  const token = await getAccessToken(admin, current.team_member_id);
  await releaseSlot(token, current.google_event_id, ctx.config.slotTitle);
  await admin.from("meetings").update({ status: "cancelada", updated_at: new Date().toISOString() }).eq("id", current.id);
  await note(admin, agent.workspace_id, contact.id, `Reunião de ${formatWhen(current.starts_at)} cancelada a pedido do cliente.`);
  return "CANCELADA. Confirme ao cliente que a reunião foi cancelada e pergunte se ele quer marcar outro horário.";
}
