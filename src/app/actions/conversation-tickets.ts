"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { conversationKey, isTicketStatus, type TicketStatus } from "@/lib/conversation-tickets";

export type ActionResult = { error: string | null; ok?: boolean };

export type ConversationTicket = { conversation_key: string; status: TicketStatus; responsible_user_id: string | null };

export async function getConversationTickets(workspaceId: string): Promise<ConversationTicket[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("conversation_tickets")
    .select("conversation_key, status, responsible_user_id")
    .eq("workspace_id", workspaceId);
  return (data || []).filter((t): t is ConversationTicket => isTicketStatus(t.status));
}

export async function setConversationStatus(contactId: string, agentId: string | null, status: TicketStatus): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("conversation_tickets").upsert(
    {
      workspace_id: workspace.id,
      contact_id: contactId,
      agent_id: agentId,
      conversation_key: conversationKey(contactId, agentId),
      status,
      status_changed_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id,conversation_key" }
  );
  if (error) return { error: "Não foi possível atualizar o status." };

  revalidatePath("/conversas");
  return { error: null, ok: true };
}

export async function setConversationResponsible(contactId: string, agentId: string | null, userId: string | null): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("conversation_tickets").upsert(
    {
      workspace_id: workspace.id,
      contact_id: contactId,
      agent_id: agentId,
      conversation_key: conversationKey(contactId, agentId),
      responsible_user_id: userId,
    },
    { onConflict: "workspace_id,conversation_key" }
  );
  if (error) return { error: "Não foi possível atribuir o responsável." };

  revalidatePath("/conversas");
  return { error: null, ok: true };
}
