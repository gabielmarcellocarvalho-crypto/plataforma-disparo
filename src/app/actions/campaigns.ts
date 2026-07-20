"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";

export type ActionResult = { error: string | null; ok?: boolean };

export async function createCampaign(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  const channel = String(formData.get("channel") || "");
  const mode = String(formData.get("mode") || "blast");
  const agentId = String(formData.get("agent_id") || "").trim() || null;
  const templatesRaw = String(formData.get("templates") || "");
  const delayMin = parseInt(String(formData.get("delay_min") || "60"), 10);
  const delayMax = parseInt(String(formData.get("delay_max") || "180"), 10);
  const hourStart = parseInt(String(formData.get("hour_start") || "9"), 10);
  const hourEnd = parseInt(String(formData.get("hour_end") || "20"), 10);

  if (!name) return { error: "Informe um nome pra campanha." };
  if (channel !== "whatsapp" && channel !== "email") return { error: "Canal inválido." };
  if (mode !== "blast" && mode !== "agent") return { error: "Modo inválido." };
  if (mode === "agent" && channel !== "whatsapp") return { error: "Modo agente só está disponível pro canal WhatsApp." };
  if (mode === "agent" && !agentId) return { error: "Escolha qual agente vai conduzir essa campanha." };

  const templates = templatesRaw
    .split("\n")
    .map((t) => t.trim())
    .filter(Boolean);
  if (templates.length === 0) return { error: "Escreva pelo menos uma mensagem." };

  const supabase = await createClient();

  if (mode === "agent") {
    const { data: agent } = await supabase.from("agents").select("id").eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
    if (!agent) return { error: "Agente não encontrado nesse workspace." };
  }

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspace.id,
      name,
      channel,
      mode,
      agent_id: mode === "agent" ? agentId : null,
      message_templates: templates,
      ramp_config: { delaySeconds: [delayMin, delayMax], hourStart, hourEnd, days: [1, 2, 3, 4, 5, 6] },
      status: "rascunho",
    })
    .select("id")
    .single();

  if (error || !campaign) return { error: error?.message || "Falha ao criar campanha." };

  revalidatePath("/campanhas");
  return { error: null, ok: true };
}

// Popula a fila de disparo com os contatos ativos do workspace (respeitando opt-out do canal)
// e marca a campanha como ativa.
export async function activateCampaign(campaignId: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, channel, workspace_id")
    .eq("id", campaignId)
    .eq("workspace_id", workspace.id)
    .maybeSingle();
  if (!campaign) return { error: "Campanha não encontrada." };

  const optOutColumn = campaign.channel === "whatsapp" ? "opt_out_whatsapp" : "opt_out_email";
  const contactColumn = campaign.channel === "whatsapp" ? "phone" : "email";

  const { data: contacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq(optOutColumn, false)
    .not(contactColumn, "is", null);

  if (!contacts || contacts.length === 0) {
    return { error: `Nenhum contato com ${contactColumn === "phone" ? "telefone" : "e-mail"} válido e sem opt-out.` };
  }

  const recipients = contacts.map((c) => ({ campaign_id: campaignId, contact_id: c.id }));
  const { error: insertError } = await supabase
    .from("campaign_recipients")
    .upsert(recipients, { onConflict: "campaign_id,contact_id", ignoreDuplicates: true });
  if (insertError) return { error: insertError.message };

  const { error: statusError } = await supabase
    .from("campaigns")
    .update({ status: "ativa" })
    .eq("id", campaignId);
  if (statusError) return { error: statusError.message };

  revalidatePath("/campanhas");
  return { error: null, ok: true };
}

export async function pauseCampaign(campaignId: string) {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return;
  const supabase = await createClient();
  await supabase.from("campaigns").update({ status: "pausada" }).eq("id", campaignId).eq("workspace_id", workspace.id);
  revalidatePath("/campanhas");
}
