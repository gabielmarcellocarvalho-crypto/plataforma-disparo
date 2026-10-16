import { describe, expect, it } from "vitest";
import { adContextNote, parseReferral } from "@/lib/ad-referral";

describe("parseReferral", () => {
  it("lê título, texto e link do anúncio", () => {
    expect(parseReferral({ headline: " Boné Lacoste ", body: "Chegou", source_url: "https://fb.me/x", source_type: "ad" })).toEqual({
      headline: "Boné Lacoste",
      body: "Chegou",
      sourceUrl: "https://fb.me/x",
      sourceType: "ad",
    });
  });
  it("ignora referral vazio ou ausente", () => {
    expect(parseReferral(undefined)).toBeNull();
    expect(parseReferral({ ctwa_clid: "abc" })).toBeNull();
  });
});

describe("adContextNote", () => {
  it("avisa o agente quando o lead veio de anúncio", () => {
    expect(adContextNote({ anuncio_titulo: "Boné Lacoste" })).toContain("Boné Lacoste");
  });
  it("não diz nada sem anúncio", () => {
    expect(adContextNote({ produto: "x" })).toBe("");
    expect(adContextNote(null)).toBe("");
  });
});
