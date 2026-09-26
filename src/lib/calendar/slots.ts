// Seleção dos horários que o agente oferece. O closer marca disponibilidade criando na própria agenda
// eventos com um título combinado ("Marque aqui" por padrão) — cada um é um horário marcável, com a
// duração do próprio evento. Nada aqui fala com o Google: recebe os eventos já lidos e decide.

export const DEFAULT_SLOT_TITLE = "Marque aqui";

export type CalendarEvent = {
  id: string;
  summary?: string | null;
  status?: string | null;
  // Evento de dia inteiro vem só com `date` — não serve como horário de reunião.
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
};

export type Slot = { eventId: string; start: string; end: string };

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

function normalizeTitle(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// "Marque aqui", "marque aqui ", "MARQUE AQUÍ" contam; "Marque aqui - João" não (já virou outra coisa).
export function isSlotTitle(title: string | null | undefined, slotTitle: string = DEFAULT_SLOT_TITLE): boolean {
  if (!title) return false;
  return normalizeTitle(title) === normalizeTitle(slotTitle || DEFAULT_SLOT_TITLE);
}

export type SlotRules = { slotTitle: string; minNoticeHours: number; daysAhead: number; now: Date };

// Todos os "Marque aqui" livres dentro da janela, em ordem de início.
export function availableSlots(events: CalendarEvent[], rules: SlotRules): Slot[] {
  const from = rules.now.getTime() + rules.minNoticeHours * 3_600_000;
  const to = rules.now.getTime() + rules.daysAhead * 86_400_000;
  return events
    .filter((e) => e.status !== "cancelled" && isSlotTitle(e.summary, rules.slotTitle))
    .filter((e) => e.start?.dateTime && e.end?.dateTime)
    .map((e) => ({ eventId: e.id, start: e.start!.dateTime!, end: e.end!.dateTime! }))
    .filter((s) => {
      const t = new Date(s.start).getTime();
      return t >= from && t <= to;
    })
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}

// Dia civil em Brasília — é o que o lead entende por "dia".
function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

// O que o agente oferece: até `max` opções espalhadas por dias diferentes (primeiro o horário mais
// cedo de cada dia, depois completa com os seguintes). Quatro horários na mesma manhã é pior pro lead
// do que um por dia.
export function pickSlots(events: CalendarEvent[], rules: SlotRules, max = 4): Slot[] {
  const all = availableSlots(events, rules);
  const byDay = new Map<string, Slot[]>();
  for (const s of all) {
    const k = dayKey(s.start);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k)!.push(s);
  }
  const picked: Slot[] = [];
  for (let round = 0; picked.length < max; round++) {
    let added = false;
    for (const slots of byDay.values()) {
      if (slots[round] && picked.length < max) {
        picked.push(slots[round]);
        added = true;
      }
    }
    if (!added) break;
  }
  return picked.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
}
