// Helper síncrono — separado de automation-rules.ts (Server Actions, só pode exportar funções async).
// Nenhuma das regras manda mensagem (o cliente pode nem ter template aprovado): só cria tarefa ou move a etapa.
export type AutomationRuleType = "contact_stale" | "stale_discard";

export const AUTOMATION_RULE_TYPES: AutomationRuleType[] = ["contact_stale", "stale_discard"];

export function isAutomationRuleType(value: string): value is AutomationRuleType {
  return (AUTOMATION_RULE_TYPES as string[]).includes(value);
}
