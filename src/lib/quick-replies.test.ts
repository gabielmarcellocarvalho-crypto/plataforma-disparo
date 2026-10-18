import { describe, expect, it } from "vitest";
import { matchQuickReplies, normalizeShortcut, quickReplyQuery } from "@/lib/quick-replies";

describe("quickReplyQuery", () => {
  it("detecta o atalho no começo do composer", () => {
    expect(quickReplyQuery("/")).toBe("");
    expect(quickReplyQuery("/pre")).toBe("pre");
    expect(quickReplyQuery("/Preço")).toBe("preco");
  });
  it("ignora texto normal", () => {
    expect(quickReplyQuery("oi")).toBeNull();
    expect(quickReplyQuery("/pre ço")).toBeNull();
    expect(quickReplyQuery("a/b")).toBeNull();
  });
});

describe("matchQuickReplies", () => {
  const list = [
    { id: "1", shortcut: "preco", text: "Nosso preço é R$ 99." },
    { id: "2", shortcut: "pix", text: "A chave pix é…" },
  ];
  it("filtra por atalho ou texto", () => {
    expect(matchQuickReplies(list, "pi").map((r) => r.id)).toEqual(["2"]);
    expect(matchQuickReplies(list, "")).toHaveLength(2);
    expect(matchQuickReplies(list, "nosso").map((r) => r.id)).toEqual(["1"]);
  });
  it("normaliza atalho", () => {
    expect(normalizeShortcut("Boas Vindas!")).toBe("boasvindas");
  });
});
