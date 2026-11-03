import { describe, expect, it } from "vitest";
import { formatSharedContacts, formatSharedLocation, phonesFromVcard } from "./incoming-shared";

describe("formatSharedLocation", () => {
  it("monta texto com nome, endereço e coordenadas", () => {
    expect(formatSharedLocation({ latitude: -5.8, longitude: -35.2, name: "Loja", address: "Rua A" })).toBe(
      "[O cliente compartilhou uma localização: Loja — Rua A (lat -5.8, long -35.2)]"
    );
  });
  it("devolve null sem nada útil", () => {
    expect(formatSharedLocation({})).toBeNull();
  });
});

describe("formatSharedContacts", () => {
  it("um contato", () => {
    expect(formatSharedContacts([{ name: "Maria", phones: ["+55 84 99999-0000"] }])).toBe("[O cliente compartilhou um contato: Maria — +55 84 99999-0000]");
  });
  it("vários contatos", () => {
    expect(formatSharedContacts([{ name: "A", phones: ["1"] }, { name: "B" }])).toBe("[O cliente compartilhou 2 contatos: A — 1; B]");
  });
  it("vazio vira null", () => {
    expect(formatSharedContacts([{}])).toBeNull();
  });
});

describe("phonesFromVcard", () => {
  it("lê TEL com parâmetros", () => {
    expect(phonesFromVcard("BEGIN:VCARD\nFN:Maria\nTEL;type=CELL;waid=558499990000:+55 84 9999-0000\nEND:VCARD")).toEqual(["+55 84 9999-0000"]);
  });
});
