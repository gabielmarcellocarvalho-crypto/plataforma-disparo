import type { createAdminClient } from "@/lib/supabase/admin";
import { listAllMetaCloudTemplates } from "@/lib/metacloud-templates";

type AdminClient = ReturnType<typeof createAdminClient>;

// O que fica registrado na conversa quando um template é enviado. Antes era só "[Template: nome]": quem
// olhava a conversa (e o agente de IA, que lê o histórico) não via o que o lead recebeu. Agora vai o texto
// do template já com as variáveis preenchidas. Best-effort: se a Meta não responder, grava só o nome.
const TTL_MS = 10 * 60_000;
const cache = new Map<string, { at: number; bodies: Map<string, string> }>();

async function bodiesOf(wabaId: string): Promise<Map<string, string>> {
  const hit = cache.get(wabaId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.bodies;
  const bodies = new Map<string, string>();
  for (const t of await listAllMetaCloudTemplates(wabaId)) if (t.bodyText) bodies.set(`${t.name}|${t.language}`, t.bodyText);
  cache.set(wabaId, { at: Date.now(), bodies });
  return bodies;
}

export function fillTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (original, n: string) => params[Number(n) - 1] ?? original);
}

export async function templateLogContent(
  supabase: AdminClient,
  where: { wabaId?: string | null; phoneNumberId?: string | null },
  name: string,
  language: string,
  params: string[]
): Promise<string> {
  const base = `[Template: ${name}]`;
  try {
    let wabaId = where.wabaId || null;
    if (!wabaId && where.phoneNumberId) {
      const { data } = await supabase.from("whatsapp_instances").select("meta_waba_id").eq("phone_number_id", where.phoneNumberId).not("meta_waba_id", "is", null).limit(1).maybeSingle();
      wabaId = (data?.meta_waba_id as string | null) ?? null;
    }
    if (!wabaId) return base;
    const body = (await bodiesOf(wabaId)).get(`${name}|${language}`);
    return body ? `${base}\n${fillTemplateBody(body, params)}` : base;
  } catch {
    return base;
  }
}
