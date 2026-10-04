// Evento template_category_update da Meta: a Meta reclassificou um template (ex.: utilidade → marketing).
// Chega no mesmo endpoint do webhook de mensagens, dentro de entry[].changes[] com field próprio.
// A rota já exige o segredo da URL (WHATSAPP_WEBHOOK_SECRET) antes de chegar aqui.
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type TemplateCategoryChange = {
  wabaId: string;
  templateId: string | null;
  templateName: string;
  language: string | null;
  previousCategory: string | null;
  newCategory: string | null;
  correctCategory: string | null;
};

type Change = { field?: string; value?: Record<string, unknown> };
type Body = { entry?: Array<{ id?: string; changes?: Change[] }> };

export function parseTemplateCategoryChanges(body: unknown): TemplateCategoryChange[] {
  const out: TemplateCategoryChange[] = [];
  for (const entry of (body as Body)?.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== "template_category_update" || !change.value || !entry.id) continue;
      const v = change.value;
      const str = (x: unknown) => (typeof x === "string" && x ? x : null);
      const name = str(v.message_template_name);
      if (!name) continue;
      out.push({
        wabaId: entry.id,
        templateId: str(v.message_template_id),
        templateName: name,
        language: str(v.message_template_language),
        previousCategory: str(v.previous_category),
        newCategory: str(v.new_category),
        correctCategory: str(v.correct_category),
      });
    }
  }
  return out;
}

// Grava o alerta no workspace dono do WABA. WABA sem número cadastrado aqui é ignorado.
export async function saveTemplateCategoryChanges(admin: AdminClient, changes: TemplateCategoryChange[]): Promise<number> {
  let saved = 0;
  for (const c of changes) {
    const { data: instance } = await admin.from("whatsapp_instances").select("workspace_id").eq("meta_waba_id", c.wabaId).limit(1).maybeSingle();
    if (!instance?.workspace_id) continue;
    const { error } = await admin.from("template_category_alerts").insert({
      workspace_id: instance.workspace_id,
      waba_id: c.wabaId,
      template_id: c.templateId,
      template_name: c.templateName,
      language: c.language,
      previous_category: c.previousCategory,
      new_category: c.newCategory,
      correct_category: c.correctCategory,
    });
    if (error) console.error("Falha ao gravar alerta de categoria de template:", error.message);
    else saved += 1;
  }
  return saved;
}
