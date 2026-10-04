"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { listAllMetaCloudTemplates, createMetaCloudTemplate, type MetaTemplateRow, type MetaTemplateCategory } from "@/lib/metacloud-templates";

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

export async function listWorkspaceTemplates(): Promise<Result<{ templates: MetaTemplateRow[] }>> {
  const waba = await wabaOfWorkspace();
  if (!waba) return { error: "Nenhum número conectado direto pela Meta neste workspace." };
  try {
    return { error: null, templates: await listAllMetaCloudTemplates(waba.wabaId) };
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
  sampleValues: string[];
}): Promise<Result<{ status: string }>> {
  const waba = await wabaOfWorkspace();
  if (!waba) return { error: "Nenhum número conectado direto pela Meta neste workspace." };

  const name = input.name.trim();
  if (!NAME_RE.test(name)) return { error: "Nome do template: só letras minúsculas, números e _ (sem espaço ou acento)." };
  if (!CATEGORIES.includes(input.category as MetaTemplateCategory)) return { error: "Escolha utilidade ou marketing." };
  const bodyText = input.bodyText.trim();
  if (!bodyText || bodyText.length > 1024) return { error: "O texto precisa ter de 1 a 1024 caracteres." };

  // Variáveis precisam ser {{1}}, {{2}}... sem pular número, e cada uma precisa de um exemplo (regra da Meta).
  const vars = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const unique = [...new Set(vars)].sort((a, b) => a - b);
  const sequential = unique.every((n, i) => n === i + 1);
  if (!sequential) return { error: "As variáveis precisam ser {{1}}, {{2}}… em sequência, sem pular número." };
  const samples = input.sampleValues.map((s) => s.trim());
  if (unique.length > 0 && (samples.length < unique.length || samples.slice(0, unique.length).some((s) => !s))) {
    return { error: "Preencha um exemplo para cada variável ({{1}}, {{2}}…)." };
  }

  try {
    const created = await createMetaCloudTemplate(waba.wabaId, {
      name,
      language: input.language || "pt_BR",
      category: input.category as MetaTemplateCategory,
      bodyText,
      sampleValues: samples.slice(0, unique.length),
    });
    revalidatePath("/templates");
    return { error: null, status: created.status };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A Meta recusou o template." };
  }
}
