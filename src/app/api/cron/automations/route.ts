import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secureEqual } from "@/lib/secure-compare";
import { runWorkflowsTick } from "@/lib/workflow-engine";

// Roda periodicamente (disparo externo configurado pelo usuário, mesmo esquema já usado pro
// dispatch-campaigns — não está no vercel.json de propósito). Avalia dois motores de automação:
//   1. Regras V1 (fixas, sem builder visual): contato parado, criando uma tarefa de follow-up.
//   2. Workflows (Fase 1, builder visual): matricula leads que batem no gatilho/público e avança
//      execuções pendentes (workflow-engine.ts). Delay de horas/minutos precisa de execução
//      frequente — igual ao dispatch-campaigns, o ideal é o cron externo bater aqui a cada minuto.
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;

async function hasOpenAutomationTask(supabase: AdminClient, ruleId: string, column: "contact_id", recordId: string): Promise<boolean> {
  const { count } = await supabase
    .from("tasks")
    .select("id", { count: "exact", head: true })
    .eq("automation_rule_id", ruleId)
    .eq(column, recordId)
    .is("completed_at", null);
  return (count ?? 0) > 0;
}

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || !secureEqual(auth, `Bearer ${process.env.CRON_SECRET}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("id, workspace_id, type, days_threshold")
    .eq("enabled", true);

  let tasksCreated = 0;

  for (const rule of rules || []) {
    const cutoffIso = new Date(Date.now() - rule.days_threshold * 86400_000).toISOString();

    if (rule.type === "contact_stale") {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id, name, phone, company_id, responsible_user_id")
        .eq("workspace_id", rule.workspace_id)
        .not("stage", "in", "(concluido,descartado)")
        .lt("stage_changed_at", cutoffIso);

      for (const contact of contacts || []) {
        if (await hasOpenAutomationTask(supabase, rule.id, "contact_id", contact.id)) continue;
        const { error } = await supabase.from("tasks").insert({
          workspace_id: rule.workspace_id,
          title: `Contato parado: ${contact.name || contact.phone || "sem nome"}`,
          contact_id: contact.id,
          company_id: contact.company_id,
          responsible_user_id: contact.responsible_user_id,
          automation_rule_id: rule.id,
        });
        if (!error) tasksCreated++;
      }
    }
  }

  const { enrolled, processed } = await runWorkflowsTick();

  return NextResponse.json({ ok: true, tasksCreated, workflowsEnrolled: enrolled, workflowRunsProcessed: processed });
}
