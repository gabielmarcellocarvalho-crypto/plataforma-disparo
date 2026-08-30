// Helpers síncronos de status de atendimento — separados de conversation-tickets.ts (Server Actions,
// que só pode exportar funções async) por exigência do Next.js.
export type TicketStatus = "aberto" | "pendente" | "resolvido";

export function isTicketStatus(value: string): value is TicketStatus {
  return value === "aberto" || value === "pendente" || value === "resolvido";
}

// Mesmo critério de agrupamento de "conversa" usado em conversas/page.tsx (contact_id + agent_id, ou
// contact_id + "instance" quando é disparo avulso sem IA).
export function conversationKey(contactId: string, agentId: string | null): string {
  return agentId ? `${contactId}:agent:${agentId}` : `${contactId}:instance`;
}
