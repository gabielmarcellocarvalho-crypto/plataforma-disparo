// Cliente HTTP da API da Nuvemshop. SÓ LEITURA, por construção: a única função exportada faz GET,
// e não há parâmetro de método. Escrever na loja de um cliente exige uma função nova, escrita de
// propósito, não um argumento a mais aqui. (spec 2026-10-07)

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
