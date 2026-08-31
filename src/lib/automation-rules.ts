// Helper síncrono — separado de automation-rules.ts (Server Actions, só pode exportar funções async).
export type AutomationRuleType = "contact_stale";

export function isAutomationRuleType(value: string): value is AutomationRuleType {
  return value === "contact_stale";
}
