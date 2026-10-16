import { describe, expect, it, vi } from "vitest";
import { createDraftOrder, isValidStoreId, NuvemshopError, nuvemshopGet } from "@/lib/integrations/nuvemshop/client";

const creds = { storeId: "1234567", token: "t".repeat(40) };
const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("nuvemshopGet", () => {
  it("faz só GET, com o token no header e User-Agent", async () => {
    const f = reply(200, [{ id: 1 }]);
    await nuvemshopGet(creds, "/orders", { per_page: 2, q: "x" }, f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(init.method).toBe("GET");
    expect(String(url)).toBe("https://api.nuvemshop.com.br/2025-03/1234567/orders?per_page=2&q=x");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authentication).toBe(`bearer ${creds.token}`);
    expect(headers["User-Agent"]).toContain("AutoMax");
    expect(init.body).toBeUndefined();
  });
  it("404 vira nada encontrado", async () => {
    expect(await nuvemshopGet(creds, "/orders", {}, reply(404))).toBeNull();
  });
  it("401 e 403 viram erro de autenticação", async () => {
    await expect(nuvemshopGet(creds, "/store", {}, reply(401))).rejects.toMatchObject({ kind: "auth" });
    await expect(nuvemshopGet(creds, "/store", {}, reply(403))).rejects.toBeInstanceOf(NuvemshopError);
  });
  it("recusa ID de loja que não seja só número", async () => {
    const f = reply(200);
    await expect(nuvemshopGet({ ...creds, storeId: "123/../9" }, "/store", {}, f)).rejects.toBeInstanceOf(NuvemshopError);
    expect(f).not.toHaveBeenCalled();
  });
  it("erro de servidor não vaza o token na mensagem", async () => {
    await expect(nuvemshopGet(creds, "/store", {}, reply(500))).rejects.toSatisfy((e: Error) => !e.message.includes(creds.token));
  });
});

describe("isValidStoreId", () => {
  it("só dígitos", () => {
    expect(isValidStoreId("1234567")).toBe(true);
    expect(isValidStoreId("12")).toBe(false);
    expect(isValidStoreId("12a456")).toBe(false);
    expect(isValidStoreId("")).toBe(false);
  });
});

describe("createDraftOrder", () => {
  const input = { name: "Ana", lastname: "Silva", email: "ana@x.com", phone: "5511999999999", items: [{ variantId: 10, quantity: 2 }] };
  it("cria rascunho NÃO pago e devolve o link", async () => {
    const f = reply(201, { id: 77, checkout_url: "https://loja.com/checkout/abc" });
    const out = await createDraftOrder(creds, input, f);
    expect(out).toEqual({ id: 77, checkoutUrl: "https://loja.com/checkout/abc" });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.nuvemshop.com.br/2025-03/1234567/draft_orders");
    expect(init.method).toBe("POST");
    const body = JSON.parse(String(init.body));
    expect(body.payment_status).toBe("unpaid");
    expect(body.products).toEqual([{ variant_id: 10, quantity: 2 }]);
  });
  it("sem link na resposta é erro, nunca link inventado", async () => {
    await expect(createDraftOrder(creds, input, reply(201, { id: 1 }))).rejects.toBeInstanceOf(NuvemshopError);
  });
  it("403 vira erro de autenticação e não repete a chamada", async () => {
    const f = reply(403);
    await expect(createDraftOrder(creds, input, f)).rejects.toMatchObject({ kind: "auth" });
    expect(f).toHaveBeenCalledTimes(1);
  });
});
