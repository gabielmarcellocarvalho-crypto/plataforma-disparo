// Chamadas à Graph API do Facebook. `fetch` direto, como nos outros módulos de integração.

export const GRAPH = "https://graph.facebook.com/v21.0";

// Permissões pedidas na conexão. `leads_retrieval` é a que lê os leads; as de página listam e assinam.
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "leads_retrieval"];

export function appId(): string {
  const id = process.env.NEXT_PUBLIC_META_APP_ID;
  if (!id) throw new Error("NEXT_PUBLIC_META_APP_ID não configurado.");
  return id;
}

export function appSecret(): string {
  const secret = process.env.META_APP_SECRET;
  if (!secret) throw new Error("META_APP_SECRET não configurado.");
  return secret;
}

export class GraphError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } };
  if (!res.ok || data.error) {
    throw new GraphError(`Graph ${res.status}: ${data.error?.message ?? "erro desconhecido"}`, data.error?.code ?? null);
  }
  return data;
}

// `token` vazio = chamada sem autorização (troca de código do login), sem cabeçalho.
export async function graphGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return parse<T>(await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} }));
}

export async function graphPost<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return parse<T>(await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } }));
}

// Lista completa seguindo a paginação da Graph API (cada página traz 25 por padrão).
export async function graphAll<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;
  let page = await graphGet<{ data: T[]; paging?: { next?: string } }>(path, token, { limit: "100", ...params });
  for (;;) {
    out.push(...(page.data || []));
    next = page.paging?.next ?? null;
    if (!next) return out;
    page = await parse<{ data: T[]; paging?: { next?: string } }>(await fetch(next, { headers: { Authorization: `Bearer ${token}` } }));
  }
}
