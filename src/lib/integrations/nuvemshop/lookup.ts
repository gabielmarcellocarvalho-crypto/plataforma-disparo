import { nuvemshopGet, type NuvemshopCreds } from "@/lib/integrations/nuvemshop/client";
import { orderBelongsToContact, shapeOrder, shapeProduct, type AgentOrder, type AgentProduct, type ContactIdentity } from "@/lib/integrations/nuvemshop/shape";

// Buscas de leitura usadas pelas ferramentas do agente. Todo pedido passa por orderBelongsToContact
// antes de sair: o agente só enxerga pedido de quem está na conversa.

type Raw = Record<string, unknown>;

const MAX_ORDERS_REPLY = 3;
// A API não busca pedido por telefone, então pra quem não tem e-mail lemos as páginas mais recentes
// (a lista já vem do mais novo pro mais antigo) e filtramos aqui. Limite baixo de propósito: poucas
// chamadas por consulta, longe do teto de requisições da loja.
const PAGE_SIZE = 100;
const MAX_PAGES = 3;

export async function findOrdersForContact(creds: NuvemshopCreds, contact: ContactIdentity): Promise<AgentOrder[]> {
  const found: Raw[] = [];
  const seen = new Set<string>();
  const take = (list: unknown) => {
    for (const o of Array.isArray(list) ? (list as Raw[]) : []) {
      const key = String(o.id ?? o.number);
      if (seen.has(key) || !orderBelongsToContact(o, contact)) continue;
      seen.add(key);
      found.push(o);
    }
  };

  // E-mail é exato e barato: uma chamada.
  const mail = (contact.email || "").trim();
  if (mail) take(await nuvemshopGet<Raw[]>(creds, "/orders", { q: mail, per_page: 20 }));

  if (found.length === 0 && contact.phone) {
    for (let page = 1; page <= MAX_PAGES && found.length < MAX_ORDERS_REPLY; page++) {
      const list = await nuvemshopGet<Raw[]>(creds, "/orders", { per_page: PAGE_SIZE, page });
      if (!list || list.length === 0) break;
      take(list);
      if (list.length < PAGE_SIZE) break;
    }
  }

  found.sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  return found.slice(0, MAX_ORDERS_REPLY).map(shapeOrder);
}

// Pedido pelo número. Se existir mas não for da pessoa, o resultado é o mesmo de "não existe": não
// confirmar a existência de pedido alheio.
export async function findOrderByNumber(creds: NuvemshopCreds, contact: ContactIdentity, number: string): Promise<AgentOrder | null> {
  const digits = number.replace(/\D/g, "");
  if (!digits || digits.length > 12) return null;
  const list = await nuvemshopGet<Raw[]>(creds, "/orders", { q: digits, per_page: 10 });
  const match = (list || []).find((o) => String(o.number) === String(Number(digits)));
  if (!match || !orderBelongsToContact(match, contact)) return null;
  return shapeOrder(match);
}

const SEARCH_FETCH = 50;
const SEARCH_REPLY = 10;
const STOPWORDS = new Set(["de", "da", "do", "das", "dos", "o", "a", "os", "as", "um", "uma", "e", "com", "para", "pra", "no", "na"]);

const fold = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function productText(p: Raw): { words: string[]; flat: string } {
  const name = p.name && typeof p.name === "object" ? Object.values(p.name as Raw).join(" ") : String(p.name ?? "");
  const variants = Array.isArray(p.variants) ? (p.variants as Raw[]) : [];
  const extra = variants.map((v) => `${v.sku ?? ""} ${Array.isArray(v.values) ? v.values.map((x) => Object.values((x as Raw) ?? {}).join(" ")).join(" ") : ""}`).join(" ");
  const flat = fold(`${name} ${p.sku ?? ""} ${extra}`);
  return { words: flat.split(/[^a-z0-9]+/).filter(Boolean), flat };
}

function inStock(p: Raw): boolean {
  const variants = Array.isArray(p.variants) ? (p.variants as Raw[]) : [];
  if (variants.length === 0) return true;
  return variants.some((v) => !(v.stock_management === true || v.stock_management === "true") || Number(v.stock) > 0);
}

// A busca da Nuvemshop é frouxa ("tenis" traz também "Tennis") e, com poucos resultados por página, deixava
// de fora produto em estoque. Pegamos mais, exigimos todas as palavras (inteiras) e mostramos primeiro o que tem estoque.
export async function searchProducts(creds: NuvemshopCreds, term: string): Promise<AgentProduct[]> {
  const q = term.trim().slice(0, 80);
  if (!q) return [];
  const list = (await nuvemshopGet<Raw[]>(creds, "/products", { q, per_page: SEARCH_FETCH, published: true })) || [];
  const tokens = fold(q).split(/[^a-z0-9]+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  let picked = list;
  if (tokens.length > 0) {
    const exact = list.filter((p) => {
      const { words, flat } = productText(p);
      return tokens.every((t) => words.some((w) => w === t || (t.length >= 3 && w.startsWith(t))) || (t.length >= 3 && flat.includes(t) && /\d/.test(t)));
    });
    picked = exact.length > 0 ? exact : list.slice(0, 5);
  }
  const ordered = [...picked.filter(inStock), ...picked.filter((p) => !inStock(p))];
  return ordered.slice(0, SEARCH_REPLY).map(shapeProduct);
}

export async function fetchStoreName(creds: NuvemshopCreds): Promise<string | null> {
  const store = await nuvemshopGet<Raw>(creds, "/store");
  if (!store) return null;
  const name = store.name;
  if (typeof name === "string") return name;
  if (name && typeof name === "object") {
    const o = name as Record<string, unknown>;
    return String(o.pt ?? o.es ?? Object.values(o)[0] ?? "") || null;
  }
  return null;
}
