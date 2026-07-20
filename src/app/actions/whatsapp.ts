"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createInstance, setWebhook, connectionState, fetchQrCode, instanceNameFor } from "@/lib/evolution";

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
