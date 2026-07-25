// Estágios do funil (CRM/Kanban) — fonte única, usada pelo prompt do agente, pelo webhook, pelo
// dispatcher de campanhas e pela UI do Kanban. Unificado: serve contato vindo de agente de IA,
// disparo em massa (WhatsApp sem IA) ou campanha de e-mail, já que contacts é uma tabela só.
export type ContactStage =
  | "nao_abordado"
  | "abordado"
  | "interessado"
  | "encaminhamento"
  | "fechando_proposta"
  | "concluido"
  | "descartado";

export const STAGE_ORDER: ContactStage[] = [
  "nao_abordado",
  "abordado",
  "interessado",
  "encaminhamento",
  "fechando_proposta",
  "concluido",
  "descartado",
];

export const STAGE_LABELS: Record<ContactStage, string> = {
  nao_abordado: "Não abordado",
  abordado: "Abordado",
  interessado: "Interessado",
  encaminhamento: "Encaminhamento",
  fechando_proposta: "Fechando proposta",
  concluido: "Concluído",
  descartado: "Descartado",
};

export function isContactStage(value: string): value is ContactStage {
  return (STAGE_ORDER as string[]).includes(value);
}

// O agente classifica a cada resposta, então pode "errar pra trás" por ruído do modelo — só deixa
// avançar (nunca regredir), exceto pros dois estados terminais que fazem sentido a qualquer momento.
export function canAdvanceStage(current: ContactStage, next: ContactStage): boolean {
  if (next === current) return false;
  if (next === "descartado" || next === "concluido") return true;
  return STAGE_ORDER.indexOf(next) > STAGE_ORDER.indexOf(current);
}

// Quantos dias parado na mesma fase é motivo de "ponto de atenção" visual no card (não aplica aos
// estados finais — lead concluído ou descartado não precisa de alerta de tempo parado).
export const STALE_AFTER_DAYS = 5;

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

// Vocabulário que o agente de IA usa na tag [[STATUS: <palavra>]] — palavras simples, sem acento,
// mais fáceis do modelo escrever de forma consistente do que a chave interna. "nao_abordado" fica
// de fora de propósito: é só o estado inicial antes de qualquer contato, o agente nunca volta pra ele.
export const STATUS_TAG_TO_STAGE: Record<string, ContactStage> = {
  abordado: "abordado",
  interessado: "interessado",
  encaminhamento: "encaminhamento",
  proposta: "fechando_proposta",
  fechando_proposta: "fechando_proposta",
  concluido: "concluido",
  descartado: "descartado",
};
