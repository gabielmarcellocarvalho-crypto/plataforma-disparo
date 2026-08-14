"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { isContactStage } from "@/lib/crm-stages";

export type ActionResult = { error: string | null; ok?: boolean };

export async function createCampaign(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  const channel = String(formData.get("channel") || "");
  const mode = String(formData.get("mode") || "blast");
  const agentId = String(formData.get("agent_id") || "").trim() || null;
  const whatsappInstanceId = String(formData.get("whatsapp_instance_id") || "").trim() || null;
  const dialog360TemplateName = String(formData.get("dialog360_template_name") || "").trim() || null;
  const dialog360TemplateLang = String(formData.get("dialog360_template_lang") || "").trim() || null;
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

  // Modo blast em WhatsApp precisa saber qual número dispara — obrigatório assim que o workspace tem
  // mais de um número conectado (senão não dá pra saber qual usar); com só 1 número, o form nem
  // mostra o seletor, mas ainda manda o id no hidden input.
  let whatsappInstance: { id: string; channel: string } | null = null;
  if (mode === "blast" && channel === "whatsapp") {
    if (!whatsappInstanceId) return { error: "Nenhum número de WhatsApp conectado pra esse workspace (conecte em Configurações)." };
    const { data } = await supabase
      .from("whatsapp_instances")
      .select("id, channel")
      .eq("id", whatsappInstanceId)
      .eq("workspace_id", workspace.id)
      .maybeSingle();
    if (!data) return { error: "Número selecionado não encontrado nesse workspace." };
    whatsappInstance = data;
    if (data.channel === "360dialog" && !dialog360TemplateName) {
      return { error: "Esse número usa API oficial (360dialog) — informe o nome do template aprovado pela Meta pra disparo frio." };
    }
  }

  const { data: campaign, error } = await supabase
    .from("campaigns")
    .insert({
      workspace_id: workspace.id,
      name,
      channel,
      mode,
      agent_id: mode === "agent" ? agentId : null,
      whatsapp_instance_id: whatsappInstance?.id ?? null,
      dialog360_template_name: whatsappInstance?.channel === "360dialog" ? dialog360TemplateName : null,
      dialog360_template_lang: whatsappInstance?.channel === "360dialog" ? dialog360TemplateLang || "pt_BR" : null,
      message_templates: templates,
      // ramp = cota diária crescente (anti-ban), mesma faixa já validada no piloto: 50 disparos no
      // dia 1 da campanha, 80 no dia 2, até estabilizar em 300/dia a partir do 6º dia.
      ramp_config: {
        delaySeconds: [delayMin, delayMax],
        hourStart,
        hourEnd,
        days: [1, 2, 3, 4, 5, 6],
        ramp: [50, 80, 120, 170, 230, 300],
      },
      status: "rascunho",
    })
    .select("id")
    .single();

  if (error || !campaign) return { error: error?.message || "Falha ao criar campanha." };

  revalidatePath("/campanhas");
  return { error: null, ok: true };
}

export type ActivateCampaignFilters = {
  stages: string[]; // fases do CRM selecionadas (vazio = todas as fases, sem filtro de estágio)
  sinceDays: number | null; // só quem mudou de fase do CRM nos últimos N dias (null = sem limite)
};

// Popula a fila de disparo com os contatos do workspace (respeitando opt-out do canal e, opcionalmente,
// segmentando por uma ou mais fases do CRM) e marca a campanha como ativa.
export async function activateCampaign(
  campaignId: string,
  filters: ActivateCampaignFilters = { stages: [], sinceDays: null }
): Promise<ActionResult> {
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

  let query = supabase
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspace.id)
    .eq(optOutColumn, false)
    .not(contactColumn, "is", null);

  if (filters.stages.length > 0) {
    const validStages = filters.stages.filter(isContactStage);
    if (validStages.length === 0) return { error: "Selecione ao menos uma fase válida do CRM." };
    query = query.in("stage", validStages);
  }
  if (filters.sinceDays && filters.sinceDays > 0) {
    const since = new Date(Date.now() - filters.sinceDays * 86400000).toISOString();
    query = query.gte("stage_changed_at", since);
  }

  const { data: contacts } = await query;

  if (!contacts || contacts.length === 0) {
    return { error: `Nenhum contato encontrado com esse filtro e ${contactColumn === "phone" ? "telefone" : "e-mail"} válido, sem opt-out.` };
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
