"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createInstance, setWebhook, connectionState, fetchQrCode, instanceNameFor } from "@/lib/evolution";
import { setDialog360Webhook } from "@/lib/dialog360";
import { headers } from "next/headers";

export type ConnectResult = { error: string | null; qrcodeBase64?: string | null };

export async function connectWhatsapp(): Promise<ConnectResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const instanceName = instanceNameFor(workspace.id);
  const supabase = await createClient();

  try {
    const { qrcodeBase64 } = await createInstance(instanceName);
    await setWebhook(instanceName).catch(() => null); // webhook é best-effort, não trava a conexão

    await supabase.from("whatsapp_instances").upsert(
      { workspace_id: workspace.id, instance_name: instanceName, connection_status: "conectando" },
      { onConflict: "instance_name" }
    );

    let qr = qrcodeBase64;
    if (!qr) {
      // instância já existia — busca um QR novo pra reconectar
      qr = await fetchQrCode(instanceName).catch(() => null);
    }

    revalidatePath("/configuracoes");
    return { error: null, qrcodeBase64: qr };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export type Dialog360ConnectResult = { error: string | null; ok?: boolean };

// Conecta (ou edita) um número via API oficial (360dialog) — diferente do Evolution, não tem QR
// code: a conta e o número já são configurados no painel do 360dialog, aqui só guardamos a API key e
// o phone_number_id (a Meta manda esse id em todo webhook, é como sabemos qual número recebeu a
// mensagem) e registramos a URL de callback. Workspace pode ter mais de uma instância 360dialog (ex.:
// Vendas + Financeiro) — por isso recebe `instanceId`: null cria um número novo (exige API key e
// phone_number_id), preenchido edita o número existente (campos em branco mantêm o valor salvo, só
// troca o que foi digitado — ex.: trocar só o departamento sem reenviar a API key).
export async function connectDialog360(
  instanceId: string | null,
  department: string,
  apiKey: string,
  phoneNumberId: string
): Promise<Dialog360ConnectResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  let key = apiKey.trim();
  let phoneId = phoneNumberId.trim();

  if (instanceId) {
    if (!key || !phoneId) {
      const { data: current } = await supabase
        .from("whatsapp_instances")
        .select("dialog360_api_key, phone_number_id")
        .eq("id", instanceId)
        .eq("workspace_id", workspace.id)
        .maybeSingle();
      if (!current) return { error: "Número não encontrado." };
      key = key || current.dialog360_api_key || "";
      phoneId = phoneId || current.phone_number_id || "";
    }
    if (!key || !phoneId) return { error: "Informe a API key e o phone number id." };

    const { error } = await supabase
      .from("whatsapp_instances")
      .update({ department: department || "vendas", dialog360_api_key: key, phone_number_id: phoneId, connection_status: "conectado" })
      .eq("id", instanceId)
      .eq("workspace_id", workspace.id);
    if (error) return { error: `Não foi possível salvar: ${error.message}` };
  } else {
    if (!key || !phoneId) return { error: "Informe a API key e o phone number id." };

    const { error } = await supabase.from("whatsapp_instances").insert({
      workspace_id: workspace.id,
      department: department || "vendas",
      channel: "360dialog",
      dialog360_api_key: key,
      phone_number_id: phoneId,
      connection_status: "conectado",
    });
    if (error) return { error: `Não foi possível salvar: ${error.message}` };
  }

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || ""}`;
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET;
  if (secret) {
    await setDialog360Webhook(key, `${siteUrl}/api/webhook/dialog360?secret=${secret}`).catch((err) =>
      console.error("Falha ao registrar webhook no 360dialog (configure manualmente):", err)
    );
  }

  revalidatePath("/configuracoes");
  return { error: null, ok: true };
}

export async function refreshWhatsappStatus() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return;

  const instanceName = instanceNameFor(workspace.id);
  const supabase = await createClient();

  try {
    const state = await connectionState(instanceName);
    await supabase
      .from("whatsapp_instances")
      .update({ connection_status: state })
      .eq("workspace_id", workspace.id)
      .eq("instance_name", instanceName);
  } catch {
    // instância pode não existir ainda — ignora, o status no banco fica como está
  }

  revalidatePath("/configuracoes");
}
