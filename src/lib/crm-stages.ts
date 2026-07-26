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

// As 4 âncoras (chegada, primeiro contato, sucesso, descarte) sempre existem — todo funil precisa
// delas. As 3 do meio são opcionais: cliente com processo simples pode esconder as que não usa.
export const HIDEABLE_STAGES: ContactStage[] = ["interessado", "encaminhamento", "fechando_proposta"];

export function resolveHiddenStages(raw: unknown): ContactStage[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is ContactStage => typeof v === "string" && (HIDEABLE_STAGES as string[]).includes(v));
}

export function getVisibleStages(hidden: ContactStage[]): ContactStage[] {
  return STAGE_ORDER.filter((s) => !hidden.includes(s));
}

// Pra exibir no Kanban: se o estágio real do contato está oculto, mostra ele na fase visível
// ANTERIOR mais próxima (nunca avança pra frente na exibição) — evita dar a impressão de que o
// lead avançou mais do que o cliente escolheu acompanhar. O dado real (contact.stage) não muda.
export function displayStageFor(stage: ContactStage, visible: ContactStage[]): ContactStage {
  if (visible.includes(stage)) return stage;
  const idx = STAGE_ORDER.indexOf(stage);
  for (let i = idx - 1; i >= 0; i--) {
    if (visible.includes(STAGE_ORDER[i])) return STAGE_ORDER[i];
  }
  return visible[0] ?? stage;
}

// Cada workspace pode renomear os rótulos exibidos no Kanban (ex.: "concluido" vira "Fechado" pra
// um cliente de vendas, ou "Passou pro vendedor" pra um de recepção) — a ORDEM e a chave interna que
// o agente classifica continuam fixas; só o texto muda. Overrides ausentes/vazios caem no padrão.
export function resolveStageLabels(overrides: unknown): Record<ContactStage, string> {
  const o = (overrides && typeof overrides === "object" ? overrides : {}) as Record<string, unknown>;
  const labels = { ...STAGE_LABELS };
  for (const stage of STAGE_ORDER) {
    const custom = o[stage];
    if (typeof custom === "string" && custom.trim()) labels[stage] = custom.trim();
  }
  return labels;
}

// O agente classifica a cada resposta, então pode "errar pra trás" por ruído do modelo — só deixa
// avançar (nunca regredir), exceto pros dois estados terminais que fazem sentido a qualquer momento.
export function canAdvanceStage(current: ContactStage, next: ContactStage): boolean {
  if (next === current) return false;
  // Descartado/concluído são estados finais, mas revivíveis: se o cliente reengaja depois (mudou de
  // ideia, quer fechar afinal, quer comprar de novo), o agente pode tirar de lá pra qualquer fase —
  // sem isso, "descartado" ficava travado pra sempre (não contava como avanço sair dele).
  if (current === "descartado" || current === "concluido") return true;
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
