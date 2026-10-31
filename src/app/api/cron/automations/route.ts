import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { secureEqual } from "@/lib/secure-compare";
import { runWorkflowsTick } from "@/lib/workflow-engine";
import { isContactStage, type ContactStage } from "@/lib/crm-stages";
import { stageForSignal, type PipelineStage } from "@/lib/pipelines";

// Roda periodicamente (disparo externo configurado pelo usuário, mesmo esquema já usado pro
// dispatch-campaigns — não está no vercel.json de propósito). Avalia dois motores de automação:
//   1. Regras V1 (fixas, sem builder visual): contato parado (cria tarefa) e
//      descartar contato sem resposta (move a etapa). Nenhuma manda mensagem.
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

// Funil padrão do workspace — o card do contato descartado precisa ir pra coluna certa, não só o sinal.
async function defaultPipelineStages(supabase: AdminClient, workspaceId: string): Promise<{ pipelineId: string; stages: PipelineStage[] } | null> {
  const { data: funil } = await supabase.from("pipelines").select("id").eq("workspace_id", workspaceId).order("is_default", { ascending: false }).order("position").limit(1).maybeSingle();
  if (!funil) return null;
  const { data } = await supabase.from("pipeline_stages").select("id, pipeline_id, name, signal, position").eq("pipeline_id", funil.id).order("position");
  const stages = (data ?? []).map((e) => ({
    id: e.id as string,
    pipeline_id: e.pipeline_id as string,
    name: e.name as string,
    signal: (isContactStage(e.signal as string) ? e.signal : "abordado") as ContactStage,
    position: e.position as number,
  }));
  return stages.length > 0 ? { pipelineId: funil.id as string, stages } : null;
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
  let contactsDiscarded = 0;

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

    if (rule.type === "stale_discard") {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("id")
        .eq("workspace_id", rule.workspace_id)
        .in("stage", ["abordado", "interessado"])
        .lt("stage_changed_at", cutoffIso);
      if (!contacts || contacts.length === 0) continue;

      const funil = await defaultPipelineStages(supabase, rule.workspace_id);
      const destino = funil ? stageForSignal("descartado", funil.stages) : null;
      const patch: Record<string, unknown> = { stage: "descartado", stage_changed_at: new Date().toISOString() };
      if (funil && destino) {
        patch.pipeline_id = funil.pipelineId;
        patch.pipeline_stage_id = destino.id;
      }
      const { error } = await supabase.from("contacts").update(patch).in("id", contacts.map((c) => c.id));
      if (!error) contactsDiscarded += contacts.length;
    }
  }

  const { enrolled, processed } = await runWorkflowsTick();

  return NextResponse.json({ ok: true, tasksCreated, contactsDiscarded, workflowsEnrolled: enrolled, workflowRunsProcessed: processed });
}
