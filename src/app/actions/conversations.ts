"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendText } from "@/lib/evolution";

export type ActionResult = { error: string | null; ok?: boolean };

// Humano assume a conversa manualmente — agente para de responder esse contato até "devolver".
export async function takeOverConversation(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ needs_attention: true, attention_reason: "Conversa assumida manualmente." })
    .eq("id", contactId);
  if (error) return { error: "Não foi possível assumir a conversa." };
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Devolve a conversa pro agente — mesma ação usada no painel de "precisa de atenção".
export async function resolveAttention(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ needs_attention: false, attention_reason: null })
    .eq("id", contactId);
  if (error) return { error: "Não foi possível devolver a conversa pro agente." };
  revalidatePath("/conversas");
  revalidatePath("/agentes");
  return { error: null, ok: true };
}

// Dispensa o alerta "pode precisar de atenção" (flagged_reason) sem mexer em needs_attention —
// o agente continua respondendo normalmente, isso só limpa o aviso na UI.
export async function dismissFlag(contactId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("contacts").update({ flagged_reason: null }).eq("id", contactId);
  if (error) return { error: "Não foi possível dispensar o alerta." };
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Apaga o histórico de mensagens desse contato com esse agente — é isso que vira contexto/"cache"
// mandado pro modelo a cada resposta. Útil pra testar do zero sem o agente carregar conversa antiga.
export async function clearConversationHistory(contactId: string, agentId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("messages").delete().eq("contact_id", contactId).eq("agent_id", agentId);
  if (error) return { error: "Não foi possível limpar o histórico." };

  await supabase.from("contacts").update({ needs_attention: false, attention_reason: null }).eq("id", contactId);

  revalidatePath("/conversas");
  revalidatePath("/agentes");
  return { error: null, ok: true };
}

// Envio manual — só funciona com a conversa assumida (needs_attention = true), pra não brigar com o agente.
export async function sendManualMessage(contactId: string, agentId: string, text: string): Promise<ActionResult> {
  const trimmed = text.trim();
  if (!trimmed) return { error: "Mensagem vazia." };

  const supabase = await createClient();
  const [{ data: contact }, { data: agent }] = await Promise.all([
    supabase.from("contacts").select("id, phone, workspace_id, needs_attention").eq("id", contactId).maybeSingle(),
    supabase.from("agents").select("evolution_instance_name").eq("id", agentId).maybeSingle(),
  ]);
  if (!contact || !agent) return { error: "Conversa não encontrada." };
  if (!contact.needs_attention) return { error: "Assuma a conversa antes de mandar mensagem manual." };
  if (!contact.phone) return { error: "Contato sem telefone." };

  try {
    await sendText(agent.evolution_instance_name, contact.phone, trimmed);
  } catch {
    return { error: "Falha ao enviar pelo WhatsApp." };
  }

  await supabase.from("messages").insert({
    workspace_id: contact.workspace_id,
    contact_id: contactId,
    agent_id: agentId,
    role: "assistant",
    content: trimmed,
  });

  revalidatePath("/conversas");
  return { error: null, ok: true };
}
