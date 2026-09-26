import type { CalendarEvent } from "@/lib/calendar/slots";
import { CalendarAuthError } from "@/lib/calendar/google-oauth";

// Chamadas à Google Calendar API sobre a agenda principal do closer. `fetch` direto no REST.

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Outro lead pegou o mesmo "Marque aqui" entre ler e marcar (o If-Match com etag falhou).
export class SlotTakenError extends Error {}

export type GoogleEvent = CalendarEvent & {
  etag?: string;
  description?: string | null;
  hangoutLink?: string | null;
  attendees?: { email: string }[];
  conferenceData?: unknown;
};

async function call(accessToken: string, url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 401) throw new CalendarAuthError("Google recusou o acesso à agenda.");
  if (res.status === 412) throw new SlotTakenError("Horário acabou de ser ocupado.");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google Calendar ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

// Eventos (recorrentes já expandidos em instâncias) entre `from` e `to`, com busca textual pelo
// título pra não trazer a agenda inteira do closer — o filtro exato de título é feito depois em slots.ts.
export async function listEvents(accessToken: string, from: Date, to: Date, query?: string): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin: from.toISOString(),
      timeMax: to.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
      ...(query ? { q: query } : {}),
      ...(pageToken ? { pageToken } : {}),
    });
    const res = await call(accessToken, `${BASE}?${params}`);
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
    events.push(...(data.items || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return events;
}

export async function getEvent(accessToken: string, eventId: string): Promise<GoogleEvent> {
  const res = await call(accessToken, `${BASE}/${encodeURIComponent(eventId)}`);
  return (await res.json()) as GoogleEvent;
}

// PATCH condicionado ao etag lido antes: se o evento mudou no meio-tempo (outro lead marcou, o closer
// editou), o Google devolve 412 e vira SlotTakenError — nunca sobrescreve a reunião de outra pessoa.
export async function patchEvent(accessToken: string, eventId: string, body: Record<string, unknown>, etag?: string): Promise<GoogleEvent> {
  const params = new URLSearchParams({ conferenceDataVersion: "1", sendUpdates: "all" });
  const res = await call(accessToken, `${BASE}/${encodeURIComponent(eventId)}?${params}`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: etag ? { "If-Match": etag } : {},
  });
  return (await res.json()) as GoogleEvent;
}

export async function deleteEvent(accessToken: string, eventId: string): Promise<void> {
  await call(accessToken, `${BASE}/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
}

export async function insertEvent(accessToken: string, body: Record<string, unknown>): Promise<GoogleEvent> {
  const res = await call(accessToken, BASE, { method: "POST", body: JSON.stringify(body) });
  return (await res.json()) as GoogleEvent;
}
