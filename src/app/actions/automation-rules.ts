"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { isAutomationRuleType, type AutomationRuleType } from "@/lib/automation-rules";

export type ActionResult = { error: string | null; ok?: boolean };
export type AutomationRule = { type: AutomationRuleType; enabled: boolean; days_threshold: number };

const DEFAULT_DAYS_THRESHOLD = 3;
const RULE_TYPES: AutomationRuleType[] = ["contact_stale"];

// Sempre retorna as 2 regras, com default (desligada, 3 dias) pros tipos sem linha ainda no banco —
// a UI não precisa tratar "regra inexistente" como caso especial.
export async function getAutomationRules(workspaceId: string): Promise<AutomationRule[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return RULE_TYPES.map((type) => ({ type, enabled: false, days_threshold: DEFAULT_DAYS_THRESHOLD }));

  const supabase = await createClient();
  const { data } = await supabase.from("automation_rules").select("type, enabled, days_threshold").eq("workspace_id", workspaceId);
  const byType = new Map((data || []).filter((r) => isAutomationRuleType(r.type)).map((r) => [r.type, r]));

  return RULE_TYPES.map((type) => byType.get(type) ?? { type, enabled: false, days_threshold: DEFAULT_DAYS_THRESHOLD });
}

export async function updateAutomationRule(
  workspaceId: string,
  type: AutomationRuleType,
  fields: { enabled: boolean; daysThreshold: number }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return { error: "Nenhum workspace ativo." };

  const daysThreshold = Math.max(1, Math.floor(fields.daysThreshold) || DEFAULT_DAYS_THRESHOLD);

  const supabase = await createClient();
  const { error } = await supabase.from("automation_rules").upsert(
    {
      workspace_id: workspaceId,
      type,
      enabled: fields.enabled,
      days_threshold: daysThreshold,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,type" }
  );
  if (error) return { error: "Não foi possível salvar a automação." };

  revalidatePath("/automacoes");
  return { error: null, ok: true };
}
