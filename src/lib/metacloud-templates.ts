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
  headerFormat?: string | null; // TEXT, IMAGE, DOCUMENT, VIDEO... (ausente = sem cabeçalho)
};

type GraphTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  correct_category?: string | null;
  status: string;
  rejected_reason?: string | null;
  components?: Array<{ type: string; text?: string; format?: string }>;
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
    headerFormat: t.components?.find((c) => c.type === "HEADER")?.format ?? null,
  }));
}

// Exemplo de mídia do cabeçalho: a Meta exige um arquivo de amostra na análise do template. Sobe pelo envio
// retomável (/{app}/uploads) e devolve o "handle" que vai em header_handle. Esse arquivo é só amostra: cada
// envio do template leva a mídia própria.
export async function uploadTemplateExampleMedia(bytes: ArrayBuffer, mimeType: string, fileName: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!appId) throw new Error("NEXT_PUBLIC_META_APP_ID não configurado.");
  const auth = { Authorization: `OAuth ${systemUserToken()}` };
  const start = new URLSearchParams({ file_length: String(bytes.byteLength), file_type: mimeType, file_name: fileName });
  const s = await fetch(`${BASE_URL}/${appId}/uploads?${start.toString()}`, { method: "POST", headers: auth });
  const session = (await s.json().catch(() => null)) as { id?: string; error?: { message?: string } } | null;
  if (!s.ok || !session?.id) throw new Error(session?.error?.message || `Meta respondeu ${s.status} ao iniciar o envio do exemplo.`);
  const u = await fetch(`${BASE_URL}/${session.id}`, { method: "POST", headers: { ...auth, file_offset: "0" }, body: bytes });
  const done = (await u.json().catch(() => null)) as { h?: string; error?: { message?: string } } | null;
  if (!u.ok || !done?.h) throw new Error(done?.error?.message || `Meta respondeu ${u.status} ao enviar o exemplo.`);
  return done.h;
}

export type NewMetaTemplate = {
  name: string; // minúsculas, números e _ (regra da Meta)
  language: string; // ex.: pt_BR
  category: MetaTemplateCategory;
  bodyText: string; // pode ter {{1}}, {{2}}...
  sampleValues: string[]; // um exemplo pra cada variável, exigido pela Meta quando há variável
  header?: { format: "IMAGE" | "DOCUMENT"; handle: string } | null; // cabeçalho de mídia (handle do uploadTemplateExampleMedia)
};

// Cria o template no WABA. Retorna o id e o status inicial (normalmente PENDING, em análise).
export async function createMetaCloudTemplate(wabaId: string, t: NewMetaTemplate): Promise<{ id: string; status: string; category: string }> {
  const body: Record<string, unknown> = {
    name: t.name,
    language: t.language,
    category: t.category,
    components: [
      ...(t.header ? [{ type: "HEADER", format: t.header.format, example: { header_handle: [t.header.handle] } }] : []),
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
