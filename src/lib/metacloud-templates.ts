// Gestão de templates direto pela Graph API da Meta (conexão oficial, sem 360dialog).
// Lista todos os status (não só aprovados) e cria template que a Meta analisa. A categoria final é
// decidida pela Meta: `correct_category` mostra pra onde ela vai mover o template antes de mudar.
import { BASE_URL, systemUserToken } from "@/lib/metacloud";

export type MetaTemplateCategory = "MARKETING" | "UTILITY" | "AUTHENTICATION";

export type MetaTemplateRow = {
  id: string;
  name: string;
  language: string;
  category: MetaTemplateCategory | string;
  correctCategory: MetaTemplateCategory | string | null;
  status: string; // APPROVED, PENDING, REJECTED, PAUSED, DISABLED...
  rejectedReason: string | null;
  bodyText: string | null;
};

type GraphTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  correct_category?: string | null;
  status: string;
  rejected_reason?: string | null;
  components?: Array<{ type: string; text?: string }>;
};

export async function listAllMetaCloudTemplates(wabaId: string): Promise<MetaTemplateRow[]> {
  const fields = "id,name,language,category,correct_category,status,rejected_reason,components";
  const res = await fetch(`${BASE_URL}/${wabaId}/message_templates?limit=1000&fields=${fields}`, {
    headers: { Authorization: `Bearer ${systemUserToken()}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meta Graph API respondeu ${res.status} ao listar templates.`);
  const data = (await res.json()) as { data?: GraphTemplate[] };
  return (data.data || []).map((t) => ({
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    correctCategory: t.correct_category ?? null,
    status: t.status,
    rejectedReason: t.rejected_reason ?? null,
    bodyText: t.components?.find((c) => c.type === "BODY")?.text ?? null,
  }));
}

export type NewMetaTemplate = {
  name: string; // minúsculas, números e _ (regra da Meta)
  language: string; // ex.: pt_BR
  category: MetaTemplateCategory;
  bodyText: string; // pode ter {{1}}, {{2}}...
  sampleValues: string[]; // um exemplo pra cada variável, exigido pela Meta quando há variável
};

// Cria o template no WABA. Retorna o id e o status inicial (normalmente PENDING, em análise).
export async function createMetaCloudTemplate(wabaId: string, t: NewMetaTemplate): Promise<{ id: string; status: string; category: string }> {
  const body: Record<string, unknown> = {
    name: t.name,
    language: t.language,
    category: t.category,
    components: [
      {
        type: "BODY",
        text: t.bodyText,
        ...(t.sampleValues.length > 0 ? { example: { body_text: [t.sampleValues] } } : {}),
      },
    ],
  };
  const res = await fetch(`${BASE_URL}/${wabaId}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${systemUserToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => null)) as { id?: string; status?: string; category?: string; error?: { message?: string; error_user_msg?: string } } | null;
  if (!res.ok || !data?.id) {
    const msg = data?.error?.error_user_msg || data?.error?.message || `Meta respondeu ${res.status}`;
    throw new Error(msg);
  }
  return { id: data.id, status: data.status || "PENDING", category: data.category || t.category };
}
