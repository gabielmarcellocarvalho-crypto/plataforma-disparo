import type { ContactStage } from "@/lib/crm-stages";

// Plano comercial do workspace — define até onde o funil de conversão da Visão geral vai. SDR
// entrega o lead qualificado e passa a bola (o funil dele termina em "encaminhamento", não faz
// sentido cobrar/mostrar taxa de fechamento de quem não fecha). Closer e SDR+Closer conduzem até o
// fim ("concluido"). Não mexe no Kanban/fases visíveis do CRM — isso continua uma preferência de
// processo por cliente, independente do plano contratado.
export type WorkspacePlan = "sdr" | "closer" | "sdr_closer" | "disparo_avulso" | "sdr_disparo";

export const WORKSPACE_PLANS: { key: WorkspacePlan; label: string; short: string; funnelEnd: ContactStage }[] = [
  { key: "sdr", label: "SDR", short: "Qualifica e encaminha — funil vai até \"encaminhamento\".", funnelEnd: "encaminhamento" },
  { key: "closer", label: "Closer", short: "Negocia e fecha sozinho — funil vai até \"concluído\".", funnelEnd: "concluido" },
  { key: "sdr_closer", label: "SDR + Closer", short: "Os dois papéis — funil completo, até \"concluído\".", funnelEnd: "concluido" },
  { key: "disparo_avulso", label: "Disparo Avulso", short: "Só disparo em massa, sem agente — sem funil/conversão na Visão geral.", funnelEnd: "abordado" },
  {
    key: "sdr_disparo",
    label: "SDR + Disparo",
    short: "SDR qualifica e encaminha, além de disparo em massa no mesmo workspace — funil vai até \"encaminhamento\".",
    funnelEnd: "encaminhamento",
  },
];

export function isWorkspacePlan(value: unknown): value is WorkspacePlan {
  return typeof value === "string" && WORKSPACE_PLANS.some((p) => p.key === value);
}

// Nulo (workspace criado antes desse campo existir) cai em "sdr_closer" — funil completo, é o
// comportamento que já existia antes dessa mudança, até a agência classificar o cliente de verdade.
export function resolveWorkspacePlan(raw: unknown): WorkspacePlan {
  return isWorkspacePlan(raw) ? raw : "sdr_closer";
}

export function planFunnelEnd(plan: WorkspacePlan): ContactStage {
  return WORKSPACE_PLANS.find((p) => p.key === plan)!.funnelEnd;
}

export function planLabel(plan: WorkspacePlan): string {
  return WORKSPACE_PLANS.find((p) => p.key === plan)?.label ?? plan;
}

// "Responsável" (vendedor humano que assume o lead após o handoff) só faz sentido onde existe SDR
// pra entregar o handoff — Closer puro fecha sozinho, sem passar a bola pra ninguém.
export function planHasSdr(plan: WorkspacePlan): boolean {
  return plan === "sdr" || plan === "sdr_closer" || plan === "sdr_disparo";
}

// Disparo Avulso não tem agente classificando/movendo leads — não faz sentido mostrar taxa de
// resposta/interesse/qualificação nem funil de estágios pra esse plano.
export function planHasConversion(plan: WorkspacePlan): boolean {
  return plan !== "disparo_avulso";
}
