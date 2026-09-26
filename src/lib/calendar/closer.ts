// Com qual closer o SDR marca. Regra (spec, decisão B):
//   1. lead com reunião ativa → o closer dessa reunião (remarcar/cancelar é sempre com ele);
//   2. dono do lead (contacts.team_member_id), se estiver na lista do agente, conectado e com horário;
//   3. senão rodízio: entre os elegíveis, quem recebeu reunião há mais tempo (nunca recebeu = primeiro).
// Função pura — quem chama junta os dados do banco e do Google.

export type CloserCandidate = {
  id: string;
  connected: boolean;
  hasSlots: boolean;
  // Início da última reunião atribuída (created_at), null se nunca recebeu.
  lastMeetingAt: string | null;
};

export type PickCloserInput = {
  closerIds: string[];
  ownerId: string | null;
  activeMeetingCloserId: string | null;
  candidates: CloserCandidate[];
};

export function pickCloser({ closerIds, ownerId, activeMeetingCloserId, candidates }: PickCloserInput): string | null {
  if (activeMeetingCloserId) return activeMeetingCloserId;

  const allowed = new Set(closerIds);
  const eligible = candidates.filter((c) => allowed.has(c.id) && c.connected && c.hasSlots);
  if (eligible.length === 0) return null;

  if (ownerId && eligible.some((c) => c.id === ownerId)) return ownerId;

  // Rodízio: quem nunca recebeu vem antes; empate desfeito pela ordem configurada no agente, pra ser
  // previsível (a mesma entrada sempre dá o mesmo closer).
  const order = new Map(closerIds.map((id, i) => [id, i]));
  return [...eligible].sort((a, b) => {
    const ta = a.lastMeetingAt ? new Date(a.lastMeetingAt).getTime() : -Infinity;
    const tb = b.lastMeetingAt ? new Date(b.lastMeetingAt).getTime() : -Infinity;
    if (ta !== tb) return ta - tb;
    return (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  })[0].id;
}
