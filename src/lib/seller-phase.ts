// Fase do vendedor: nas etapas marcadas no agente, a IA para de responder o lead e a conversa fica com
// a equipe (pelo painel ou pelo celular, na coexistência).
//
// As etapas são as do funil do próprio cliente (pipeline_stages), escolhidas uma a uma — não "a partir
// do sinal X": cada cliente ordena e nomeia o funil do seu jeito, e várias etapas podem ter o mesmo
// sinal (ex.: "Visita agendada" e "Visita realizada"). Lead sem etapa de funil, ou workspace sem funil,
// cai na comparação pelo sinal (contacts.stage).
//
// A trava é checada em toda mensagem pela etapa ATUAL do contato, não só no momento em que ele entra:
// assim vale também pro card que o vendedor arrastou no CRM, e a IA volta sozinha quando o lead sai
// das etapas marcadas.
import type { SellerPhaseConfig } from "@/lib/agent-prompt";

export type SellerPhaseContact = { stage: string | null | undefined; pipeline_stage_id?: string | null };

export function inSellerPhase(contact: SellerPhaseContact, cfg: SellerPhaseConfig): boolean {
  if (!cfg.enabled) return false;
  if (contact.pipeline_stage_id && cfg.stageIds.length > 0) return cfg.stageIds.includes(contact.pipeline_stage_id);
  return Boolean(contact.stage) && cfg.signals.includes(contact.stage as string);
}

export const SELLER_PHASE_REASON = "Fase do vendedor — a IA não responde esse lead. Para ela voltar, mova o lead para uma etapa em que a IA atende.";
