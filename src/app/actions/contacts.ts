"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getCurrentUserName } from "@/lib/workspace";
import { normalizePhone, parseContactsFile } from "@/lib/import-contacts";
import { isContactStage, STAGE_ORDER, HIDEABLE_STAGES, type ContactStage } from "@/lib/crm-stages";

export type ActionResult = { error: string | null; ok?: boolean };

export async function addContact(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  const phoneRaw = String(formData.get("phone") || "").trim();
  const email = String(formData.get("email") || "").trim();

  const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  if (phoneRaw && !phone) return { error: "Telefone inválido." };
  if (!phone && !email) return { error: "Informe telefone ou e-mail." };

  const supabase = await createClient();
  const { error } = await supabase.from("contacts").insert({
    workspace_id: workspace.id,
    name: name || null,
    phone,
    email: email || null,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe um contato com esse telefone/e-mail neste workspace." };
    return { error: error.message };
  }

  revalidatePath("/contatos");
  return { error: null, ok: true };
}

export type ImportResult = {
  error: string | null;
  imported?: number;
  skippedDuplicate?: number;
  skippedInvalid?: number;
  total?: number;
};

export async function importContacts(_prevState: ImportResult, formData: FormData): Promise<ImportResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Selecione um arquivo." };

  const buffer = Buffer.from(await file.arrayBuffer());

  let parsed;
  try {
    parsed = parseContactsFile(buffer);
  } catch (err) {
    return { error: `Não consegui ler o arquivo: ${(err as Error).message}` };
  }
  if (parsed.error) return { error: parsed.error };
  if (parsed.contacts.length === 0) return { error: "Nenhum contato válido encontrado na planilha." };

  const supabase = await createClient();
  const rows = parsed.contacts.map((c) => ({
    workspace_id: workspace.id,
    name: c.name || null,
    phone: c.phone,
    email: c.email || null,
  }));

  // upsert ignorando duplicados (telefone único por workspace) — insere em lotes de 500
  let imported = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error, count } = await supabase
      .from("contacts")
      .upsert(batch, { onConflict: "workspace_id,phone", ignoreDuplicates: true, count: "exact" });
    if (error) return { error: `Erro ao importar: ${error.message}` };
    imported += count ?? 0;
  }

  revalidatePath("/contatos");
  return {
    error: null,
    imported,
    skippedDuplicate: rows.length - imported,
    skippedInvalid: parsed.skippedNoPhoneOrEmail,
    total: parsed.total,
  };
}

// Mover o card manualmente no Kanban — vale pra contato de qualquer canal (agente, disparo em
// massa ou e-mail), já que o estágio é um campo só, compartilhado.
export async function updateContactStage(contactId: string, stage: string): Promise<ActionResult> {
  if (!isContactStage(stage)) return { error: "Estágio inválido." };
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ stage, stage_changed_at: new Date().toISOString() })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível mover o contato." };

  revalidatePath("/crm");
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Atribui/remove o vendedor responsável por um lead (só faz sentido em plano com SDR — quem entrega
// o handoff pra um humano). userId vazio limpa a atribuição.
export async function updateContactResponsible(contactId: string, userId: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ responsible_user_id: userId || null })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível atribuir o responsável." };

  revalidatePath("/crm");
  revalidatePath("/conversas");
  return { error: null, ok: true };
}

// Renomeia os rótulos do funil pra esse workspace (o sinal interno que o agente classifica não muda,
// só o texto exibido) e escolhe quais das 3 fases opcionais do meio ficam visíveis — as 4 âncoras
// (não abordado, abordado, concluído, descartado) nunca podem ser escondidas.
export async function updateCrmStageSettings(
  workspaceId: string,
  labels: Record<string, string>,
  hiddenStages: string[]
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return { error: "Nenhum workspace ativo." };

  const cleanLabels: Record<string, string> = {};
  for (const stage of STAGE_ORDER) {
    const v = labels[stage];
    if (typeof v === "string" && v.trim()) cleanLabels[stage] = v.trim().slice(0, 40);
  }
  const cleanHidden = hiddenStages.filter((s): s is ContactStage => (HIDEABLE_STAGES as string[]).includes(s));

  const supabase = await createClient();
  const { error } = await supabase
    .from("workspaces")
    .update({ crm_stage_labels: cleanLabels, crm_hidden_stages: cleanHidden })
    .eq("id", workspaceId);
  if (error) return { error: "Não foi possível salvar as fases." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}

export type ContactDetail = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  stage_changed_at: string;
  custom_fields: Record<string, string> | null;
  needs_attention: boolean;
  attention_reason: string | null;
  flagged_reason: string | null;
  created_at: string;
};
export type ContactNote = { id: string; author_name: string | null; content: string; created_at: string };

// Puxa o contato + histórico de observações pro painel de detalhe do CRM (aberto ao clicar no card).
export async function getContactDetail(contactId: string): Promise<{ contact: ContactDetail; notes: ContactNote[] } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const supabase = await createClient();
  const [{ data: contact }, { data: notes }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, phone, email, stage, stage_changed_at, custom_fields, needs_attention, attention_reason, flagged_reason, created_at")
      .eq("id", contactId)
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("contact_notes")
      .select("id, author_name, content, created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
  ]);
  if (!contact) return null;

  return { contact, notes: notes || [] };
}

// Edição manual de "infos pessoais" — nome/telefone/e-mail e os campos customizados (chave/valor
// livre, tipo gênero/cidade), pra dar de preencher isso mesmo em contato que não veio do agente.
export async function updateContactInfo(
  contactId: string,
  fields: { name: string; phone: string; email: string; customFields: Record<string, string> }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const phone = fields.phone.trim() ? normalizePhone(fields.phone) : null;
  if (fields.phone.trim() && !phone) return { error: "Telefone inválido." };

  const cleanFields = Object.fromEntries(
    Object.entries(fields.customFields)
      .map(([k, v]) => [k.trim(), v.trim()])
      .filter(([k, v]) => k && v)
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({
      name: fields.name.trim() || null,
      phone,
      email: fields.email.trim() || null,
      custom_fields: cleanFields,
    })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) {
    if (error.code === "23505") return { error: "Já existe outro contato com esse telefone/e-mail." };
    return { error: "Não foi possível salvar." };
  }

  revalidatePath("/crm");
  revalidatePath("/contatos");
  return { error: null, ok: true };
}

// Observação interna do time — vira uma linha no histórico, nunca some/sobrescreve a anterior.
export async function addContactNote(contactId: string, content: string): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Escreva alguma coisa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const authorName = await getCurrentUserName();
  const supabase = await createClient();
  const { error } = await supabase.from("contact_notes").insert({
    contact_id: contactId,
    workspace_id: workspace.id,
    author_name: authorName,
    content: trimmed,
  });
  if (error) return { error: "Não foi possível salvar a observação." };

  revalidatePath("/crm");
  return { error: null, ok: true };
}

export async function deleteContact(id: string) {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return;
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id).eq("workspace_id", workspace.id);
  revalidatePath("/contatos");
}
