// Cliente HTTP da API da Nuvemshop. `nuvemshopGet` é SÓ LEITURA, sem parâmetro de método. Escrever na
// loja é uma função própria e específica (`createDraftOrder`), nunca um argumento a mais no GET:
// a única escrita que existe cria PEDIDO RASCUNHO (link de pagamento) e não confirma nada. (spec 2026-10-07)

const API_VERSION = "2025-03";
const BASE = "https://api.nuvemshop.com.br";
const TIMEOUT_MS = 8000;
const USER_AGENT = "AutoMax (contato@automax.tec.br)";

export type NuvemshopCreds = { storeId: string; token: string };

export type NuvemshopErrorKind = "auth" | "rate" | "other";

export class NuvemshopError extends Error {
  kind: NuvemshopErrorKind;
  status: number;
  constructor(kind: NuvemshopErrorKind, status: number, message: string) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

// O ID entra na URL, então só aceita dígitos (nada de "../" ou "?").
export function isValidStoreId(value: string): boolean {
  return /^\d{3,15}$/.test(value);
}

type Query = Record<string, string | number | boolean | undefined>;

export async function nuvemshopGet<T>(
  creds: NuvemshopCreds,
  path: string,
  query: Query = {},
  fetchImpl: typeof fetch = fetch
): Promise<T | null> {
  if (!isValidStoreId(creds.storeId)) throw new NuvemshopError("other", 0, "ID da loja inválido.");
  if (!path.startsWith("/")) throw new NuvemshopError("other", 0, "Caminho inválido.");

  const url = new URL(`${BASE}/${API_VERSION}/${creds.storeId}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));

  // Uma repetição só, e só no limite de requisições (429).
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: "GET",
        headers: { Authentication: `bearer ${creds.token}`, "User-Agent": USER_AGENT, Accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new NuvemshopError("other", 0, "A Nuvemshop não respondeu a tempo.");
    }
    if (res.status === 429 && attempt === 0) {
      await new Promise((r) => setTimeout(r, 1200));
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new NuvemshopError("auth", res.status, "Token recusado pela Nuvemshop.");
    if (res.status === 429) throw new NuvemshopError("rate", 429, "Limite de requisições da Nuvemshop.");
    // Lista vazia vem como 404 ("Last page is 0"). Pra quem chama, é "nada encontrado".
    if (res.status === 404) return null;
    if (!res.ok) throw new NuvemshopError("other", res.status, `Nuvemshop respondeu ${res.status}.`);
    return (await res.json()) as T;
  }
  throw new NuvemshopError("rate", 429, "Limite de requisições da Nuvemshop.");
}

export type DraftOrderInput = {
  name: string;
  lastname: string;
  email: string;
  phone: string | null;
  items: { variantId: number; quantity: number }[];
};

// Cria um pedido RASCUNHO não pago e devolve o link de checkout. Não confirma o pedido, não baixa
// estoque, não cobra nada: quem paga é o cliente, pelo link. Sem repetição automática, pra uma falha
// de rede não gerar dois rascunhos.
export async function createDraftOrder(
  creds: NuvemshopCreds,
  input: DraftOrderInput,
  fetchImpl: typeof fetch = fetch
): Promise<{ id: number; checkoutUrl: string }> {
  if (!isValidStoreId(creds.storeId)) throw new NuvemshopError("other", 0, "ID da loja inválido.");
  let res: Response;
  try {
    res = await fetchImpl(new URL(`${BASE}/${API_VERSION}/${creds.storeId}/draft_orders`), {
      method: "POST",
      headers: { Authentication: `bearer ${creds.token}`, "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        contact_name: input.name,
        contact_lastname: input.lastname,
        contact_email: input.email,
        ...(input.phone ? { contact_phone: input.phone } : {}),
        payment_status: "unpaid",
        sale_channel: "WhatsApp",
        products: input.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new NuvemshopError("other", 0, "A Nuvemshop não respondeu a tempo.");
  }
  if (res.status === 401 || res.status === 403) throw new NuvemshopError("auth", res.status, "Token sem permissão para criar pedido.");
  if (res.status === 429) throw new NuvemshopError("rate", 429, "Limite de requisições da Nuvemshop.");
  if (!res.ok) throw new NuvemshopError("other", res.status, `Nuvemshop respondeu ${res.status}.`);
  const body = (await res.json()) as { id?: number; checkout_url?: string };
  if (!body.id || !body.checkout_url) throw new NuvemshopError("other", res.status, "A Nuvemshop não devolveu o link de pagamento.");
  return { id: body.id, checkoutUrl: body.checkout_url };
}
