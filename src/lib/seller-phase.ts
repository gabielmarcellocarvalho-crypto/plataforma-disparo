// Fase do vendedor: a partir da fase escolhida no agente, a IA para de responder o lead e a conversa
// fica com a equipe (pelo painel ou pelo celular, na coexistência).
//
// A trava é checada em toda mensagem pelo estágio ATUAL do contato, não só no momento em que ele entra
// na fase: assim vale também pro card que o vendedor arrastou no CRM, e a IA volta sozinha quando o lead
// é movido de volta pra uma fase anterior. Lead perdido sai da trava (se escrever de novo, a IA atende).
import { atingiuGatilho } from "@/lib/agent-handoff";
import type { SellerPhaseConfig } from "@/lib/agent-prompt";

export function inSellerPhase(stage: string | null | undefined, cfg: SellerPhaseConfig): boolean {
  if (!cfg.enabled || !stage) return false;
  if (stage === "concluido") return true;
  if (stage === "descartado") return false;
  return atingiuGatilho(stage as Parameters<typeof atingiuGatilho>[0], cfg.signal);
}

export const SELLER_PHASE_REASON = "Fase do vendedor — a IA não responde esse lead. Para ela voltar, mova o lead para uma fase anterior.";
