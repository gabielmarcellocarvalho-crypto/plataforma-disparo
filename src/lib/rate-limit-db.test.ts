import { describe, expect, it } from "vitest";

// "next/headers" e o cliente admin só existem no servidor; aqui só se testa a parte pura.
import { vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import { emailKey, ipKey, waitMessage } from "@/lib/rate-limit-db";

describe("rate-limit-db", () => {
  it("chave por e-mail ignora maiúscula e espaço, e não guarda o e-mail em texto", () => {
    expect(emailKey("login", " Fulano@Empresa.com ")).toBe(emailKey("login", "fulano@empresa.com"));
    expect(emailKey("login", "fulano@empresa.com")).not.toContain("fulano");
  });

  it("escopos diferentes não dividem contagem", () => {
    expect(emailKey("login", "a@b.com")).not.toBe(emailKey("reset", "a@b.com"));
    expect(ipKey("login", "1.2.3.4")).not.toBe(ipKey("reset", "1.2.3.4"));
  });

  it("mensagem de espera arredonda pra cima, mínimo 1 minuto", () => {
    expect(waitMessage(5)).toContain("1 minuto ");
    expect(waitMessage(61)).toContain("2 minutos");
  });
});
