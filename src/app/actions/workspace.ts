"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACTIVE_WORKSPACE_COOKIE, isCurrentUserColaborador } from "@/lib/workspace";

export type CreateWorkspaceState = { error: string | null };

export async function createWorkspace(
  _prevState: CreateWorkspaceState,
  formData: FormData
): Promise<CreateWorkspaceState> {
  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome do cliente." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("workspaces").insert({ name }).select("id").single();

  if (error) return { error: "Não foi possível criar o workspace (você precisa ser admin da agência)." };

  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, data.id, { httpOnly: true, sameSite: "lax", path: "/" });

  redirect("/");
}

export async function setActiveWorkspace(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/");
}

// Remove um workspace inteiro — apaga em cascata TODOS os dados dele (contatos, agentes, conversas,
// campanhas). Só colaborador (equipe da agência). Usa o admin client porque não há policy de DELETE
// em workspaces (RLS bloquearia o client do usuário); a autorização é feita aqui, no servidor.
export async function deleteWorkspace(workspaceId: string): Promise<{ error: string | null }> {
  if (!(await isCurrentUserColaborador())) return { error: "Só a agência pode remover um workspace." };

  const admin = createAdminClient();
  const { error } = await admin.from("workspaces").delete().eq("id", workspaceId);
  if (error) return { error: "Não foi possível remover o workspace." };

  // Se o removido era o ativo, limpa o cookie pra getCurrentWorkspace cair no próximo disponível.
  const cookieStore = await cookies();
  if (cookieStore.get(ACTIVE_WORKSPACE_COOKIE)?.value === workspaceId) {
    cookieStore.delete(ACTIVE_WORKSPACE_COOKIE);
  }

  revalidatePath("/", "layout");
  return { error: null };
}

export type SaveEstimateResult = { error: string | null };

// Estimativa salva de um workspace substitui o volume real dele na conta do total entre todos
// os clientes (ver getDispatchStats) — pensada pra cliente que ainda não tem campanha rodando.
export async function saveVolumeEstimate(
  workspaceId: string,
  emailVolume: number,
  whatsappVolume: number
): Promise<SaveEstimateResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ estimated_email_volume: emailVolume, estimated_whatsapp_volume: whatsappVolume })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível salvar a estimativa." };

  revalidatePath("/calculadora");
  return { error: null };
}

// Orçamento mensal de custo de IA + limite de alerta (%) — colaborador define por workspace.
// Alimenta o alerta na Visão geral/Métricas. budget null/0 = desliga o alerta desse cliente.
export async function saveCostBudget(
  workspaceId: string,
  budgetBrl: number | null,
  thresholdPct: number
): Promise<SaveEstimateResult> {
  const budget = budgetBrl && budgetBrl > 0 ? budgetBrl : null;
  const pct = Math.min(100, Math.max(1, Math.round(thresholdPct || 80)));

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ monthly_cost_budget_brl: budget, cost_alert_pct: pct })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível salvar o orçamento." };

  revalidatePath("/metricas");
  revalidatePath("/");
  return { error: null };
}

// Volta a usar o volume real (fila de campanhas) desse workspace na conta, descartando a estimativa manual.
export async function clearVolumeEstimate(workspaceId: string): Promise<SaveEstimateResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ estimated_email_volume: null, estimated_whatsapp_volume: null })
    .eq("id", workspaceId);

  if (error) return { error: "Não foi possível limpar a estimativa." };

  revalidatePath("/calculadora");
  return { error: null };
}
