"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import {
  isCustomFieldType,
  normalizeFieldKey,
  parseOptions,
  type CustomFieldDef,
  type CustomFieldType,
} from "@/lib/custom-fields";

export type ActionResult = { error: string | null; ok?: boolean };

const SELECT = "id, key, label, type, options, required, show_in_table, show_in_card, position";

type Row = {
  id: string;
  key: string;
  label: string;
  type: string;
  options: unknown;
  required: boolean;
  show_in_table: boolean;
  show_in_card: boolean;
  position: number;
};

function toDef(row: Row): CustomFieldDef {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: isCustomFieldType(row.type) ? row.type : "texto",
    options: parseOptions(row.options),
    required: row.required,
    show_in_table: row.show_in_table,
    show_in_card: row.show_in_card,
    position: row.position,
  };
}

// Usado tanto por página de servidor quanto por componente cliente (o drawer busca sob demanda).
export async function listCustomFieldDefs(): Promise<CustomFieldDef[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("custom_field_defs")
    .select(SELECT)
    .eq("workspace_id", workspace.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });

  return (data as Row[] | null)?.map(toDef) ?? [];
}

export type CustomFieldInput = {
  label: string;
  type: string;
  options: string[];
  required: boolean;
  showInTable: boolean;
  showInCard: boolean;
};

function cleanInput(input: CustomFieldInput): { label: string; type: CustomFieldType; options: string[]; error: string | null } {
  const label = input.label.trim().slice(0, 40);
  if (!label) return { label: "", type: "texto", options: [], error: "Dê um nome ao campo." };
  if (!isCustomFieldType(input.type)) return { label, type: "texto", options: [], error: "Tipo de campo inválido." };

  const options = parseOptions(input.options);
  if ((input.type === "selecao" || input.type === "selecao_multipla") && options.length === 0) {
    return { label, type: input.type, options, error: "Uma lista precisa de pelo menos uma opção." };
  }
  return { label, type: input.type, options, error: null };
}

function revalidateAll() {
  for (const path of ["/crm", "/contatos", "/conversas", "/metricas"]) revalidatePath(path);
}

export async function createCustomFieldDef(input: CustomFieldInput): Promise<ActionResult & { id?: string }> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const { label, type, options, error: invalid } = cleanInput(input);
  if (invalid) return { error: invalid };

  const key = normalizeFieldKey(label);
  if (!key) return { error: "Esse nome não gera uma chave válida — use letras ou números." };

  const supabase = await createClient();
  const { count } = await supabase
    .from("custom_field_defs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id);

  const { data, error } = await supabase
    .from("custom_field_defs")
    .insert({
      workspace_id: workspace.id,
      key,
      label,
      type,
      options,
      required: input.required,
      show_in_table: input.showInTable,
      show_in_card: input.showInCard,
      position: count ?? 0,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") return { error: "Já existe um campo com esse nome." };
    return { error: "Não foi possível criar o campo." };
  }

  revalidateAll();
  return { error: null, ok: true, id: data?.id };
}

// A `key` nunca é editada aqui de propósito: ela é o vínculo com os valores já gravados nos leads.
// Renomear o rótulo é seguro; renomear a chave órfãnaria tudo que já foi preenchido.
export async function updateCustomFieldDef(id: string, input: CustomFieldInput): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const { label, type, options, error: invalid } = cleanInput(input);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { error } = await supabase
    .from("custom_field_defs")
    .update({
      label,
      type,
      options,
      required: input.required,
      show_in_table: input.showInTable,
      show_in_card: input.showInCard,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("workspace_id", workspace.id);

  if (error) return { error: "Não foi possível salvar o campo." };

  revalidateAll();
  return { error: null, ok: true };
}

// Apaga só a DEFINIÇÃO. Os valores já preenchidos continuam em contacts.custom_fields e voltam a
// aparecer no drawer como campo livre — apagar dado histórico do cliente por causa de um clique de
// configuração seria destrutivo demais pro que a ação promete.
export async function deleteCustomFieldDef(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("custom_field_defs").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível remover o campo." };

  revalidateAll();
  return { error: null, ok: true };
}

export async function reorderCustomFieldDefs(orderedIds: string[]): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  // Poucos campos por workspace (dezenas no pior caso) — uma chamada por campo é aceitável e evita
  // upsert, que exigiria mandar a linha inteira de volta.
  for (let i = 0; i < orderedIds.length; i++) {
    await supabase
      .from("custom_field_defs")
      .update({ position: i })
      .eq("id", orderedIds[i])
      .eq("workspace_id", workspace.id);
  }

  revalidateAll();
  return { error: null, ok: true };
}
