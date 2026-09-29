import { describe, expect, it } from "vitest";
import { CHATBOT_TEMPLATES, interpolate, normalizeChatbotConfig, parseMenuAnswer, planFrom, renderStepText, OPT_OUT_RE, type ChatbotOption, type ChatbotStep } from "./chatbot";

const opts = (...labels: string[]): ChatbotOption[] => labels.map((label) => ({ label, tag: label, fieldKey: "", fieldValue: "", stage: "" }));
const menu = opts("Tratores Novos", "Tratores Usados", "Implementos", "Peças e oficina", "Outros");

describe("parseMenuAnswer", () => {
  it("aceita número, emoji e 'opção N'", () => {
    expect(parseMenuAnswer("1", menu)).toBe(0);
    expect(parseMenuAnswer("2️⃣", menu)).toBe(1);
    expect(parseMenuAnswer("opção 4", menu)).toBe(3);
    expect(parseMenuAnswer(" 5 ", menu)).toBe(4);
  });
  it("aceita o nome da opção, sem ligar pra acento/caixa", () => {
    expect(parseMenuAnswer("pecas e oficina", menu)).toBe(3);
    expect(parseMenuAnswer("IMPLEMENTOS", menu)).toBe(2);
    expect(parseMenuAnswer("usados", menu)).toBe(1);
  });
  it("não chuta quando é ambíguo ou fora da faixa", () => {
    expect(parseMenuAnswer("tratores", menu)).toBeNull();
    expect(parseMenuAnswer("7", menu)).toBeNull();
    expect(parseMenuAnswer("1 ou 2", menu)).toBeNull();
    expect(parseMenuAnswer("oi", menu)).toBeNull();
    expect(parseMenuAnswer("", menu)).toBeNull();
  });
});

describe("renderStepText", () => {
  it("monta o menu com emoji numerado", () => {
    const step: ChatbotStep = { id: "m", type: "menu", text: "Como ajudar?", options: opts("A", "B") };
    expect(renderStepText(step)).toBe("Como ajudar?\n1️⃣ A\n2️⃣ B");
  });
});

describe("interpolate", () => {
  it("troca primeiro nome, nome e campo", () => {
    expect(interpolate("Oi {{primeiro_nome}}, de {{campo:cidade}}!", { name: "Maria Souza", customFields: { cidade: "Lavras" } })).toBe("Oi Maria, de Lavras!");
  });
  it("variável vazia não deixa buraco feio", () => {
    expect(interpolate("Perfeito, como podemos te ajudar hoje {{primeiro_nome}}?", { name: null, customFields: {} })).toBe("Perfeito, como podemos te ajudar hoje?");
    expect(interpolate("Oi {{primeiro_nome}}, tudo bem?", { name: "", customFields: {} })).toBe("Oi, tudo bem?");
  });
});

describe("planFrom", () => {
  const steps: ChatbotStep[] = [
    { id: "a", type: "message", text: "Olá" },
    { id: "b", type: "message", text: "Tudo bem?" },
    { id: "c", type: "question", text: "Cidade?", fieldKey: "cidade", saveAsTag: false },
    { id: "d", type: "message", text: "Anotado" },
  ];
  it("manda as mensagens seguidas até a próxima pergunta", () => {
    expect(planFrom(steps, 0)).toEqual({ texts: ["Olá", "Tudo bem?", "Cidade?"], waitingIndex: 2 });
  });
  it("sem pergunta depois, sinaliza fim", () => {
    expect(planFrom(steps, 3)).toEqual({ texts: ["Anotado"], waitingIndex: null });
    expect(planFrom(steps, 4)).toEqual({ texts: [], waitingIndex: null });
  });
});

describe("normalizeChatbotConfig", () => {
  it("descarta etapa inválida e não liga sem etapas", () => {
    const c = normalizeChatbotConfig({ enabled: true, steps: [{ type: "menu", text: "x", options: [] }, { type: "qualquer" }] });
    expect(c.steps).toHaveLength(0);
    expect(c.enabled).toBe(false);
  });
  it("modelo da Luchini é válido", () => {
    const c = normalizeChatbotConfig({ ...CHATBOT_TEMPLATES[0].config, enabled: true });
    expect(c.enabled).toBe(true);
    expect(c.steps.map((s) => s.type)).toEqual(["question", "menu"]);
  });
});

describe("opt-out", () => {
  it("reconhece pedido de sair", () => {
    expect(OPT_OUT_RE.test("SAIR")).toBe(true);
    expect(OPT_OUT_RE.test("parar.")).toBe(true);
    expect(OPT_OUT_RE.test("quero sair dessa dúvida")).toBe(false);
  });
});
