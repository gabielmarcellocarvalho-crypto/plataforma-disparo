"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { normalizeChatbotConfig, type ChatbotConfig } from "@/lib/chatbot";

// Salva o chatbot de mensagens iniciais de um número. Confere que o número é do workspace ativo e que
// NÃO tem agente de IA vinculado — número com IA não usa chatbot (os dois responderiam por cima).
export async function saveChatbotConfig(instanceId: string, raw: ChatbotConfig): Promise<{ error: string | null }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const admin = createAdminClient();
  const [{ data: instance }, { data: agent }] = await Promise.all([
    admin.from("whatsapp_instances").select("id, workspace_id").eq("id", instanceId).maybeSingle(),
    admin.from("agents").select("id").eq("whatsapp_instance_id", instanceId).maybeSingle(),
  ]);
  if (!instance || instance.workspace_id !== workspace.id) return { error: "Número não encontrado." };
  if (agent) return { error: "Esse número tem agente de IA — o chatbot vale só pra número sem IA." };

  const config = normalizeChatbotConfig(raw);
  if (raw.enabled && !config.enabled) return { error: "Pra ligar, adicione pelo menos uma etapa com texto." };

  const { error } = await admin.from("whatsapp_instances").update({ chatbot: config }).eq("id", instanceId);
  if (error) return { error: "Não foi possível salvar o chatbot." };
  revalidatePath("/configuracoes");
  return { error: null };
}
