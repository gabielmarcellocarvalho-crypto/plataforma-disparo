"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createInstance, setWebhook, fetchQrCode, fetchInstanceInfo, agentInstanceNameFor } from "@/lib/evolution";

export type CreateAgentState = { error: string | null; ok?: boolean };

export async function createAgent(_prevState: CreateAgentState, formData: FormData): Promise<CreateAgentState> {
  const name = String(formData.get("name") || "").trim();
  const systemPrompt = String(formData.get("system_prompt") || "").trim();
  if (!name) return { error: "Informe o nome do agente." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("agents")
    .insert({ workspace_id: workspace.id, name, system_prompt: systemPrompt })
    .select("id")
    .single();
  if (error || !data) return { error: "Não foi possível criar o agente." };

  await supabase
    .from("agents")
    .update({ evolution_instance_name: agentInstanceNameFor(data.id) })
    .eq("id", data.id);

  revalidatePath("/agentes");
  return { error: null, ok: true };
}

export type ConnectResult = { error: string | null; qrcodeBase64?: string | null };

export async function connectAgent(agentId: string): Promise<ConnectResult> {
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle();
  if (!agent) return { error: "Agente não encontrado." };

  try {
    const { qrcodeBase64 } = await createInstance(agent.evolution_instance_name);
    await setWebhook(agent.evolution_instance_name).catch(() => null);

    await supabase.from("agents").update({ connection_status: "conectando" }).eq("id", agentId);

    let qr = qrcodeBase64;
    if (!qr) qr = await fetchQrCode(agent.evolution_instance_name).catch(() => null);

    revalidatePath("/agentes");
    return { error: null, qrcodeBase64: qr };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export async function refreshAgentStatus(agentId: string) {
  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle();
  if (!agent) return;

  try {
    const { connectionStatus, phoneNumber, photoUrl } = await fetchInstanceInfo(agent.evolution_instance_name);
    await supabase
      .from("agents")
      .update({ connection_status: connectionStatus, phone_number: phoneNumber, photo_url: photoUrl })
      .eq("id", agentId);
  } catch {
    // instância pode não existir ainda — ignora, status no banco fica como está
  }

  revalidatePath("/agentes");
}

export async function updateAgentPrompt(agentId: string, systemPrompt: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { error } = await supabase.from("agents").update({ system_prompt: systemPrompt }).eq("id", agentId);
  if (error) return { error: "Não foi possível salvar o prompt." };
  revalidatePath("/agentes");
  return { error: null };
}

export async function toggleAgentStatus(agentId: string, status: "ativo" | "pausado") {
  const supabase = await createClient();
  await supabase.from("agents").update({ status }).eq("id", agentId);
  revalidatePath("/agentes");
}

export async function updateAgentDelay(agentId: string, minSeconds: number, maxSeconds: number): Promise<{ error: string | null }> {
  if (minSeconds < 0 || maxSeconds < minSeconds) return { error: "Intervalo de delay inválido." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("agents")
    .update({ reply_delay_min_seconds: minSeconds, reply_delay_max_seconds: maxSeconds })
    .eq("id", agentId);
  if (error) return { error: "Não foi possível salvar o delay." };
  revalidatePath("/agentes");
  return { error: null };
}
