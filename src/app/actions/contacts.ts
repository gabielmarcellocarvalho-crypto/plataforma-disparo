"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { normalizePhone, parseContactsFile } from "@/lib/import-contacts";

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

export async function deleteContact(id: string) {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return;
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id).eq("workspace_id", workspace.id);
  revalidatePath("/contatos");
}
