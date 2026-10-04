"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listAllMetaCloudTemplates, createMetaCloudTemplate, type MetaTemplateRow, type MetaTemplateCategory } from "@/lib/metacloud-templates";
import { fieldOptionsFor, variableCount, validateMapping, type TemplateField } from "@/lib/template-variables";
import type { CustomFieldDef } from "@/lib/custom-fields";

type Result<T = object> = ({ error: null } & T) | { error: string };

// WABA do workspace: o número conectado direto pela Meta (canal metacloud) que tem meta_waba_id.
async function wabaOfWorkspace(): Promise<{ workspaceId: string; wabaId: string } | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from("whatsapp_instances")
    .select("meta_waba_id")
    .eq("workspace_id", workspace.id)
    .eq("channel", "metacloud")
    .not("meta_waba_id", "is", null)
    .limit(1)
    .maybeSingle();
  return data?.meta_waba_id ? { workspaceId: workspace.id, wabaId: data.meta_waba_id as string } : null;
}

// Campos que existem nesse workspace (fixos + personalizados). É daqui que a tela escolhe.
async function fieldsOfWorkspace(workspaceId: string): Promise<TemplateField[]> {
  const { data } = await createAdminClient()
    .from("custom_field_defs")
    .select("key, label, options")
    .eq("workspace_id", workspaceId)
    .order("position", { ascending: true });
  const defs = (data || []).map((d) => ({ key: d.key as string, label: d.label as string, options: (d.options as string[]) || [] })) as unknown as CustomFieldDef[];
  return fieldOptionsFor(defs);
}

export type TemplateMappings = Record<string, string[]>; // chave: "nome|idioma"
const mappingKey = (name: string, language: string) => `${name}|${language}`;

export async function listWorkspaceTemplates(): Promise<Result<{ templates: MetaTemplateRow[]; mappings: TemplateMappings; fields: TemplateField[] }>> {
  const waba = await wabaOfWorkspace();
  if (!waba) return { error: "Nenhum número conectado direto pela Meta neste workspace." };
  try {
    const [templates, fields, maps] = await Promise.all([
      listAllMetaCloudTemplates(waba.wabaId),
      fieldsOfWorkspace(waba.workspaceId),
      createAdminClient().from("template_variable_maps").select("template_name, language, variables").eq("workspace_id", waba.workspaceId),
    ]);
    const mappings: TemplateMappings = {};
    for (const m of maps.data || []) mappings[mappingKey(m.template_name as string, m.language as string)] = (m.variables as string[]) || [];
    return { error: null, templates, mappings, fields };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Não foi possível ler os templates da Meta." };
  }
}

const CATEGORIES: MetaTemplateCategory[] = ["UTILITY", "MARKETING"];
const NAME_RE = /^[a-z0-9_]{1,512}$/;

export async function createWorkspaceTemplate(input: {
  name: string;
  category: string;
  language: string;
  bodyText: string;
  variableFields: string[]; // um valor de campo por variável, na ordem {{1}}, {{2}}…
}): Promise<Result<{ status: string }>> {
  const waba = await wabaOfWorkspace();
  if (!waba) return { error: "Nenhum número conectado direto pela Meta neste workspace." };

  const name = input.name.trim();
  if (!NAME_RE.test(name)) return { error: "Nome do template: só letras minúsculas, números e _ (sem espaço ou acento)." };
  if (!CATEGORIES.includes(input.category as MetaTemplateCategory)) return { error: "Escolha utilidade ou marketing." };
  const bodyText = input.bodyText.trim();
  if (!bodyText || bodyText.length > 1024) return { error: "O texto precisa ter de 1 a 1024 caracteres." };

  // Variáveis precisam ser {{1}}, {{2}}... sem pular número (regra da Meta).
  const vars = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const count = variableCount(bodyText);
  const sequential = [...new Set(vars)].sort((a, b) => a - b).every((n, i) => n === i + 1);
  if (!sequential) return { error: "As variáveis precisam ser {{1}}, {{2}}… em sequência, sem pular número." };

  // Cada variável tem que ser um campo que existe nesse workspace. O exemplo que vai pra Meta vem do próprio campo.
  const options = await fieldsOfWorkspace(waba.workspaceId);
  const mapping = input.variableFields.slice(0, count);
  const mappingError = validateMapping(count, mapping, options);
  if (mappingError) return { error: mappingError };
  const samples = mapping.map((value) => options.find((o) => o.value === value)!.example);

  const language = input.language || "pt_BR";
  try {
    const created = await createMetaCloudTemplate(waba.wabaId, {
      name,
      language,
      category: input.category as MetaTemplateCategory,
      bodyText,
      sampleValues: samples,
    });
    if (count > 0) {
      const { error } = await createAdminClient()
        .from("template_variable_maps")
        .upsert({ workspace_id: waba.workspaceId, template_name: name, language, variables: mapping, updated_at: new Date().toISOString() }, { onConflict: "workspace_id,template_name,language" });
      if (error) console.error("Falha ao gravar o mapeamento de variáveis:", error.message);
    }
    revalidatePath("/templates");
    return { error: null, status: created.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A Meta recusou o template." };
  }
}
