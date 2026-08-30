import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secureEqual } from "@/lib/secure-compare";

// Roda periodicamente (disparo externo configurado pelo usuário, mesmo esquema já usado pro
// dispatch-campaigns — não está no vercel.json de propósito). Avalia as automações V1 (regras fixas,
// sem builder visual): negócio parado / contato parado, cada uma criando uma tarefa de follow-up se
// ainda não existir uma aberta pra aquele registro+regra (evita duplicar a cada execução).
export const maxDuration = 60;

type AdminClient = ReturnType<typeof createAdminClient>;

async function hasOpenAutomationTask(supabase: AdminClient, ruleId: string, column: "deal_id" | "contact_id", recordId: string): Promise<boolean> {
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

    if (rule.type === "deal_stale") {
      const { data: deals } = await supabase
        .from("deals")
        .select("id, name, contact_id, company_id, responsible_user_id")
        .eq("workspace_id", rule.workspace_id)
        .eq("status", "open")
        .lt("stage_changed_at", cutoffIso);

      for (const deal of deals || []) {
        if (await hasOpenAutomationTask(supabase, rule.id, "deal_id", deal.id)) continue;
        const { error } = await supabase.from("tasks").insert({
          workspace_id: rule.workspace_id,
          title: `Negócio parado: ${deal.name}`,
          deal_id: deal.id,
          contact_id: deal.contact_id,
          company_id: deal.company_id,
          responsible_user_id: deal.responsible_user_id,
          automation_rule_id: rule.id,
        });
        if (!error) tasksCreated++;
      }
    }

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

  return NextResponse.json({ ok: true, tasksCreated });
}
