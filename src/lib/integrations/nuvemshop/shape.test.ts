import { describe, expect, it } from "vitest";
import { orderBelongsToContact, phonesMatch, shapeOrder, shapeProduct } from "@/lib/integrations/nuvemshop/shape";

describe("phonesMatch", () => {
  it("casa com e sem DDI, com máscara", () => {
    expect(phonesMatch("5511956968445", "+55 (11) 95696-8445")).toBe(true);
    expect(phonesMatch("5511956968445", "11956968445")).toBe(true);
  });
  it("casa com e sem o 9 na frente", () => {
    expect(phonesMatch("5511956968445", "1156968445")).toBe(true);
    expect(phonesMatch("5511956968445", "56968445")).toBe(true);
  });
  it("não casa com DDD diferente", () => {
    expect(phonesMatch("5511956968445", "21956968445")).toBe(false);
  });
  it("não casa com final diferente nem com vazio ou curto", () => {
    expect(phonesMatch("5511956968445", "5511956968446")).toBe(false);
    expect(phonesMatch("5511956968445", "")).toBe(false);
    expect(phonesMatch("5511956968445", "1234")).toBe(false);
    expect(phonesMatch(null, "11956968445")).toBe(false);
  });
});

describe("orderBelongsToContact", () => {
  const order = {
    contact_phone: "+5511956968445",
    contact_email: "Maria@Exemplo.com",
    customer: { phone: "", email: "outro@exemplo.com" },
  };
  it("aceita pelo telefone", () => {
    expect(orderBelongsToContact(order, { phone: "5511956968445", email: null })).toBe(true);
  });
  it("aceita pelo e-mail, ignorando caixa", () => {
    expect(orderBelongsToContact(order, { phone: null, email: "maria@exemplo.com" })).toBe(true);
  });
  it("recusa pessoa diferente", () => {
    expect(orderBelongsToContact(order, { phone: "5521999990000", email: "joao@exemplo.com" })).toBe(false);
  });
  it("recusa contato sem telefone nem e-mail", () => {
    expect(orderBelongsToContact(order, { phone: null, email: null })).toBe(false);
    expect(orderBelongsToContact(null, { phone: "5511956968445", email: null })).toBe(false);
  });
});

describe("shapeOrder", () => {
  const raw = {
    id: 1,
    number: 503,
    token: "SEGREDO-DO-PEDIDO",
    gateway_link: "https://pagamento.exemplo/segredo",
    status: "open",
    payment_status: "paid",
    shipping_status: "shipped",
    currency: "BRL",
    total: "199.90",
    created_at: "2026-10-08T10:00:00-0300",
    paid_at: "2026-10-08T10:05:00-0300",
    contact_email: "a@b.com",
    billing_address: "Rua Secreta",
    billing_document_type: "CPF",
    products: [{ name: "Camiseta P", quantity: 2, cost: "10.00", price: "50", barcode: "123" }],
  };
  it("traduz status e monta só os campos permitidos", () => {
    const out = shapeOrder(raw);
    expect(out).toMatchObject({ numero: "503", situacao: "aberto", pagamento: "pago", envio: "enviado", criado_em: "2026-10-08", total: "BRL 199.90" });
    expect(out.itens).toEqual([{ nome: "Camiseta P", quantidade: 2 }]);
    expect(out.rastreio).toBeNull();
  });
  it("não deixa nada sensível passar", () => {
    const json = JSON.stringify(shapeOrder(raw));
    for (const secret of ["SEGREDO-DO-PEDIDO", "pagamento.exemplo", "Rua Secreta", "CPF", "a@b.com", "cost", "barcode"]) {
      expect(json).not.toContain(secret);
    }
  });
  it("mostra rastreio só quando a loja grava", () => {
    const out = shapeOrder({ ...raw, fulfillments: [{ tracking_info: { code: "BR123", url: "https://rastreio/BR123" } }] });
    expect(out.rastreio).toEqual({ codigo: "BR123", link: "https://rastreio/BR123" });
  });
});

describe("shapeProduct", () => {
  it("devolve preço, estoque e link sem custo", () => {
    const out = shapeProduct({
      name: { pt: "Camiseta" },
      canonical_url: "https://loja/camiseta",
      description: { pt: "<p>Algodão&nbsp;puro</p>" },
      variants: [
        { values: [{ pt: "P" }], price: "50.00", promotional_price: "40.00", cost: "10.00", stock_management: true, stock: 3 },
        { values: [{ pt: "M" }], price: "50.00", cost: "10.00", stock_management: true, stock: 0 },
        { values: [], price: "60.00", stock_management: false },
      ],
    });
    expect(out.nome).toBe("Camiseta");
    expect(out.descricao).toBe("Algodão puro");
    expect(out.variacoes).toEqual([
      { descricao: "P", preco: "R$ 40.00", estoque: "3 em estoque" },
      { descricao: "M", preco: "R$ 50.00", estoque: "sem estoque" },
      { descricao: "", preco: "R$ 60.00", estoque: "disponível" },
    ]);
    expect(JSON.stringify(out)).not.toContain("10.00");
  });
});
