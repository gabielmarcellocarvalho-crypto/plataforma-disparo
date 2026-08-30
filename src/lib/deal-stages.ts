// Estágios de negócio (Deals) — conceito separado de ContactStage (src/lib/crm-stages.ts). Nunca
// importar um arquivo do outro: contacts.stage serve o funil de atendimento/agente de IA, deals.stage
// serve o funil comercial (valor $, empresa, data de fechamento). Nomeado de forma distinta de propósito.
export type DealStatus = "open" | "won" | "lost";

export type DealStage = {
  id: string;
  name: string;
  position: number;
  color: string | null;
  is_won: boolean;
  is_lost: boolean;
};

export function isDealStatus(value: string): value is DealStatus {
  return value === "open" || value === "won" || value === "lost";
}

const CURRENCY_FORMATTER = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatDealAmount(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return CURRENCY_FORMATTER.format(amount);
}

// Negócio "atrasado": data de fechamento já passou e ainda está aberto (won/lost não alertam mais).
export function isDealStale(closeDate: string | null, status: string): boolean {
  if (!closeDate || status !== "open") return false;
  return new Date(closeDate) < new Date(new Date().toDateString());
}

export function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
