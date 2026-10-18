import { describe, expect, it } from "vitest";
import {
  isClosingMessage,
  isFarewellFromAgent,
  isLongStalledChat,
  normalizeReaction,
  parseReaction,
  shouldReactInsteadOfReply,
} from "@/lib/conversation-closing";

describe("isClosingMessage", () => {
  it.each(["Tchau", "valeu!", "Obrigado", "muito obrigada", "ok", "Até mais", "Beleza, valeu", "tchau, bom dia pra você", "👍", "🙏"])(
    "reconhece despedida/agradecimento: %s",
    (t) => expect(isClosingMessage(t)).toBe(true)
  );
  it.each(["Obrigado, quanto custa?", "ok mas tem em outra cor", "quero 2 unidades", "valeu, me manda o link", "tchau 11999998888", "", "Boa tarde"])(
    "não confunde com pedido ou pergunta: %s",
    (t) => expect(isClosingMessage(t)).toBe(false)
  );
});

describe("isFarewellFromAgent", () => {
  it("reconhece despedida do agente", () => {
    expect(isFarewellFromAgent("Qualquer coisa é só chamar. Até mais!")).toBe(true);
    expect(isFarewellFromAgent("Tenha um ótimo dia, Gabriel.")).toBe(true);
  });
  it("saudação ou pergunta não é despedida", () => {
    expect(isFarewellFromAgent("Boa tarde, Gabriel! Como posso ajudar?")).toBe(false);
    expect(isFarewellFromAgent("Qual seu tamanho?")).toBe(false);
    expect(isFarewellFromAgent("Até mais, quer que eu separe o tênis?")).toBe(false);
  });
});

describe("shouldReactInsteadOfReply", () => {
  it("tchau do cliente depois do tchau do agente: só reage", () => {
    expect(shouldReactInsteadOfReply("Tchau", "Até mais, qualquer coisa é só chamar.")).toBe(true);
  });
  it("ok do cliente no meio da conversa continua respondendo", () => {
    expect(shouldReactInsteadOfReply("ok", "Tenho do 38 ao 43. Qual o seu tamanho?")).toBe(false);
    expect(shouldReactInsteadOfReply("ok", "Boa tarde! Aqui é a Leticia.")).toBe(false);
  });
});

describe("reação", () => {
  it("só aceita emojis permitidos", () => {
    expect(normalizeReaction("👍")).toBe("👍");
    expect(normalizeReaction("❤")).toBe("❤️");
    expect(normalizeReaction("💣")).toBeNull();
  });
  it("lê a tag do modelo", () => {
    expect(parseReaction("[[REACAO: 👍]]")).toBe("👍");
    expect(parseReaction("sem tag")).toBeNull();
  });
});

describe("isLongStalledChat", () => {
  const many = Array.from({ length: 12 }, () => ({ role: "assistant" }));
  it("conversa longa que não avançou", () => {
    expect(isLongStalledChat(many, "abordado")).toBe(true);
  });
  it("quem já avançou no funil não é cortado", () => {
    expect(isLongStalledChat(many, "interessado")).toBe(false);
  });
  it("conversa curta não conta", () => {
    expect(isLongStalledChat(many.slice(0, 5), "abordado")).toBe(false);
  });
});
