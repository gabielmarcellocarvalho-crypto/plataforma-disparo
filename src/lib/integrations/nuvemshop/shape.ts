// Funções puras: decidem DE QUEM é um pedido e o que do pedido/produto o agente pode ver. O objeto
// cru da API traz custo do produto, token do pedido, link do gateway, documento e endereço completo;
// nada disso passa daqui. O que sai é uma lista fixa de campos, montada campo a campo.

type Raw = Record<string, unknown>;

const isObj = (v: unknown): v is Raw => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

// Textos da Nuvemshop vêm como { pt: "...", es: "..." }.
export function localized(v: unknown): string {
  if (typeof v === "string") return v;
  if (!isObj(v)) return "";
  return str(v.pt) || str(v.es) || str(Object.values(v).find((x) => typeof x === "string" && x));
}

// ---------- identidade: o pedido é de quem está na conversa? ----------

type PhoneParts = { ddd: string | null; last8: string };

function phoneParts(raw: unknown): PhoneParts | null {
  let d = str(raw).replace(/\D/g, "");
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  if (d.length < 8) return null;
  const last8 = d.slice(-8);
  const ddd = d.length >= 10 ? d.slice(0, 2) : null;
  return { ddd, last8 };
}

// Casa com ou sem DDI, com ou sem o 9 na frente. Se os dois lados têm DDD, precisam ser iguais.
export function phonesMatch(a: unknown, b: unknown): boolean {
  const pa = phoneParts(a);
  const pb = phoneParts(b);
  if (!pa || !pb) return false;
  if (pa.last8 !== pb.last8) return false;
  if (pa.ddd && pb.ddd && pa.ddd !== pb.ddd) return false;
  return true;
}

export type ContactIdentity = { phone: string | null; email: string | null };

export function orderBelongsToContact(order: unknown, contact: ContactIdentity): boolean {
  if (!isObj(order)) return false;
  const customer = isObj(order.customer) ? order.customer : {};
  const phones = [order.contact_phone, order.billing_phone, customer.phone, customer.billing_phone];
  if (contact.phone && phones.some((p) => phonesMatch(contact.phone, p))) return true;
  const mail = (contact.email || "").trim().toLowerCase();
  if (mail) {
    const mails = [order.contact_email, customer.email].map((e) => str(e).trim().toLowerCase());
    if (mails.includes(mail)) return true;
  }
  return false;
}

// ---------- o que o agente vê ----------

const ORDER_STATUS: Record<string, string> = { open: "aberto", closed: "concluído", cancelled: "cancelado" };
const PAYMENT_STATUS: Record<string, string> = {
  pending: "aguardando pagamento",
  authorized: "pagamento autorizado",
  paid: "pago",
  abandoned: "abandonado",
  refunded: "reembolsado",
  voided: "anulado",
};
const SHIPPING_STATUS: Record<string, string> = {
  unpacked: "ainda não separado",
  unfulfilled: "aguardando envio",
  partially_packed: "parcialmente separado",
  fulfilled: "enviado",
  shipped: "enviado",
  delivered: "entregue",
};

export type AgentOrder = {
  numero: string;
  situacao: string;
  pagamento: string;
  envio: string;
  criado_em: string;
  pago_em: string | null;
  itens: { nome: string; quantidade: number }[];
  total: string;
  rastreio: { codigo: string | null; link: string | null } | null;
};

function dateOnly(v: unknown): string {
  const s = str(v);
  return s ? s.slice(0, 10) : "";
}

// Rastreio só aparece se a loja realmente gravar (nem toda loja grava).
function trackingFrom(order: Raw): AgentOrder["rastreio"] {
  const list = Array.isArray(order.fulfillments) ? order.fulfillments : [];
  for (const f of list) {
    const info = isObj(f) && isObj(f.tracking_info) ? f.tracking_info : null;
    const code = info ? str(info.code) : "";
    const url = info ? str(info.url) : "";
    if (code || url) return { codigo: code || null, link: url || null };
  }
  return null;
}

export function shapeOrder(order: unknown): AgentOrder {
  const o = isObj(order) ? order : {};
  const items = Array.isArray(o.products) ? o.products : [];
  const currency = str(o.currency) || "BRL";
  const total = str(o.total);
  return {
    numero: str(o.number),
    situacao: ORDER_STATUS[str(o.status)] || str(o.status),
    pagamento: PAYMENT_STATUS[str(o.payment_status)] || str(o.payment_status),
    envio: SHIPPING_STATUS[str(o.shipping_status)] || str(o.shipping_status),
    criado_em: dateOnly(o.created_at),
    pago_em: dateOnly(o.paid_at) || null,
    itens: items.slice(0, 15).map((p) => {
      const item = isObj(p) ? p : {};
      return { nome: str(item.name).slice(0, 120), quantidade: Number(item.quantity) || 1 };
    }),
    total: total ? `${currency} ${total}` : "",
    rastreio: trackingFrom(o),
  };
}

export type AgentProduct = {
  nome: string;
  link: string | null;
  descricao: string;
  variacoes: { descricao: string; preco: string; estoque: string }[];
};

function plainText(html: string, max: number): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function shapeProduct(product: unknown): AgentProduct {
  const p = isObj(product) ? product : {};
  const variants = Array.isArray(p.variants) ? p.variants : [];
  return {
    nome: localized(p.name).slice(0, 160),
    link: str(p.canonical_url) || null,
    descricao: plainText(localized(p.description), 300),
    variacoes: variants.slice(0, 8).map((v) => {
      const x = isObj(v) ? v : {};
      const values = Array.isArray(x.values) ? x.values.map(localized).filter(Boolean).join(" / ") : "";
      const price = str(x.promotional_price) || str(x.price);
      let estoque = "disponível";
      if (x.stock_management === true || x.stock_management === "true") {
        const n = Number(x.stock);
        estoque = Number.isFinite(n) ? (n > 0 ? `${n} em estoque` : "sem estoque") : "disponível";
      }
      return { descricao: values.slice(0, 80), preco: price ? `R$ ${price}` : "", estoque };
    }),
  };
}
