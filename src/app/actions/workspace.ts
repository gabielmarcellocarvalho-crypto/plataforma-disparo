"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { ACTIVE_WORKSPACE_COOKIE } from "@/lib/workspace";

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
