// Helper síncrono — separado de automation-rules.ts (Server Actions, só pode exportar funções async).
export type AutomationRuleType = "deal_stale" | "contact_stale";

export function isAutomationRuleType(value: string): value is AutomationRuleType {
  return value === "deal_stale" || value === "contact_stale";
}
