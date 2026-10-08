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

export async function searchProducts(creds: NuvemshopCreds, term: string): Promise<AgentProduct[]> {
  const q = term.trim().slice(0, 80);
  if (!q) return [];
  const list = await nuvemshopGet<Raw[]>(creds, "/products", { q, per_page: 5, published: true });
  return (list || []).map(shapeProduct);
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
