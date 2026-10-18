import { createClient } from "@/lib/supabase/server";
import type { Range } from "@/lib/cost-monitor";
import { dayKeyBrt } from "@/lib/period";

// Saudação pela hora de Brasília.
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

export type MyDayTask = { id: string; title: string; due_at: string | null; contact_id: string | null; contact_name: string | null; overdue: boolean };
export type MyDayAttention = { id: string; name: string; reason: string; kind: "atencao" | "alerta" };

// Bloco "Seu dia" da Visão geral: tarefas de hoje/atrasadas e conversas aguardando a equipe, com as
// primeiras de cada lista pra mostrar ali mesmo (estilo home do HubSpot).
export async function getMyDay(workspaceId: string) {
  const supabase = await createClient();
  const now = new Date();
  const today = now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const endOfToday = new Date(`${today}T23:59:59-03:00`).toISOString();
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(now)) % 24;

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [profile, pending, attentionCount, tasks, attention] = await Promise.all([
    user ? supabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("completed_at", null)
      .lte("due_at", endOfToday),
    supabase
      .from("contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .or("needs_attention.eq.true,flagged_reason.not.is.null"),
    supabase
      .from("tasks")
      .select("id, title, due_at, contact_id, contacts(name, phone)")
      .eq("workspace_id", workspaceId)
      .is("completed_at", null)
      .lte("due_at", endOfToday)
      .order("due_at", { ascending: true })
      .limit(5),
    supabase
      .from("contacts")
      .select("id, name, phone, needs_attention, attention_reason, flagged_reason")
      .eq("workspace_id", workspaceId)
      .or("needs_attention.eq.true,flagged_reason.not.is.null")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const fullName = (profile.data as { full_name: string | null } | null)?.full_name || "";
  return {
    greeting: greetingFor(hour),
    firstName: fullName.trim().split(/\s+/)[0] || "",
    tasksPending: pending.count ?? 0,
    attention: attentionCount.count ?? 0,
    tasks: (tasks.data || []).map((t) => {
      const c = t.contacts as unknown as { name: string | null; phone: string | null } | null;
      return {
        id: t.id as string,
        title: t.title as string,
        due_at: (t.due_at as string | null) ?? null,
        contact_id: (t.contact_id as string | null) ?? null,
        contact_name: c?.name || c?.phone || null,
        overdue: Boolean(t.due_at && (t.due_at as string) < now.toISOString()),
      } satisfies MyDayTask;
    }),
    attentionList: (attention.data || []).map((c) => ({
      id: c.id as string,
      name: (c.name as string | null) || (c.phone as string | null) || "sem nome",
      reason: c.needs_attention ? (c.attention_reason as string | null) || "Precisa de atenção" : (c.flagged_reason as string) || "",
      kind: c.needs_attention ? ("atencao" as const) : ("alerta" as const),
    })) satisfies MyDayAttention[],
  };
}

const PAGE = 1000;
const MAX_PAGES = 30;

// Mensagens recebidas (do lead) por dia — par das enviadas no gráfico de volume.
export async function getReceivedByDay(workspaceId: string, range: Range): Promise<Record<string, number>> {
  const supabase = await createClient();
  const out: Record<string, number> = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data } = await supabase
      .from("messages")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .eq("role", "user")
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString())
      .order("created_at", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    const rows = data || [];
    for (const m of rows) {
      const key = dayKeyBrt(m.created_at as string);
      out[key] = (out[key] || 0) + 1;
    }
    if (rows.length < PAGE) break;
  }
  return out;
}
