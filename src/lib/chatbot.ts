// Chatbot de mensagens iniciais (números sem IA) — tipos, configuração e decisões puras. Quem fala
// com banco e WhatsApp é chatbot-engine.ts; aqui não há efeito colateral, pra poder testar.
import { STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";

export type ChatbotOption = {
  label: string;
  // Etiqueta aplicada no lead ao escolher a opção. Vazio = sem etiqueta.
  tag: string;
  // Campo do lead que recebe `fieldValue` (chave de campo personalizado). Vazio = não grava campo.
  fieldKey: string;
  fieldValue: string;
  // Etapa do Pipeline pra onde o lead vai (só avança/revive — canAdvanceStage). Vazio = não mexe.
  stage: ContactStage | "";
};

export type ChatbotStep =
  | { id: string; type: "message"; text: string }
  // fieldKey: chave de campo personalizado, "nome", "email" ou "" (só guarda na observação).
  | { id: string; type: "question"; text: string; fieldKey: string; saveAsTag: boolean }
  | { id: string; type: "menu"; text: string; options: ChatbotOption[] };

export type ChatbotConfig = { enabled: boolean; steps: ChatbotStep[]; finalMessage: string };

export const MAX_STEPS = 10;
export const MAX_OPTIONS = 9;

const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");

function normalizeOption(raw: unknown): ChatbotOption | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const label = str(o.label, 80).trim();
  if (!label) return null;
  const stage = typeof o.stage === "string" && (STAGE_ORDER as string[]).includes(o.stage) ? (o.stage as ContactStage) : "";
  return { label, tag: str(o.tag, 40).trim(), fieldKey: str(o.fieldKey, 60).trim(), fieldValue: str(o.fieldValue, 120).trim(), stage };
}

function normalizeStep(raw: unknown, i: number): ChatbotStep | null {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const id = str(s.id, 40) || `step-${i}`;
  const text = str(s.text).trim();
  if (s.type === "message") return text ? { id, type: "message", text } : null;
  if (s.type === "question") return text ? { id, type: "question", text, fieldKey: str(s.fieldKey, 60).trim(), saveAsTag: Boolean(s.saveAsTag) } : null;
  if (s.type === "menu") {
    const options = (Array.isArray(s.options) ? s.options : []).map(normalizeOption).filter((o): o is ChatbotOption => o !== null).slice(0, MAX_OPTIONS);
    return text && options.length ? { id, type: "menu", text, options } : null;
  }
  return null;
}

// Config gravada pode vir de qualquer versão da tela — tudo que não fecha vira "sem etapa".
export function normalizeChatbotConfig(raw: unknown): ChatbotConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const steps = (Array.isArray(c.steps) ? c.steps : []).map(normalizeStep).filter((s): s is ChatbotStep => s !== null).slice(0, MAX_STEPS);
  return { enabled: Boolean(c.enabled) && steps.length > 0, steps, finalMessage: str(c.finalMessage).trim() };
}

// ── Texto ──────────────────────────────────────────────────────────────────

const KEYCAP = "️⃣";
export function numberEmoji(n: number): string {
  return `${n}${KEYCAP}`;
}

export function renderStepText(step: ChatbotStep): string {
  if (step.type !== "menu") return step.text;
  return `${step.text}\n${step.options.map((o, i) => `${numberEmoji(i + 1)} ${o.label}`).join("\n")}`;
}

export type InterpolationVars = { name: string | null; customFields: Record<string, unknown> };

// {{primeiro_nome}}, {{nome}} e {{campo:chave}}. Variável sem valor some (nada de "{{nome}}" cru pro lead).
export function interpolate(text: string, vars: InterpolationVars): string {
  const nome = (vars.name || "").trim();
  const primeiro = nome.split(/\s+/)[0] || "";
  return text
    .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, primeiro)
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*campo:([a-z0-9_]+)\s*\}\}/gi, (_, key: string) => {
      const v = vars.customFields[key];
      return v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : String(v);
    })
    // Sobra de variável vazia deixa espaço duplo / espaço antes de pontuação ("Oi , tudo bem").
    .replace(/[ \t]+([,.!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

// ── Resposta do menu ───────────────────────────────────────────────────────

const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");
function key(s: string): string {
  return s.normalize("NFD").replace(DIACRITICS, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Qual opção o lead escolheu (índice) ou null. Aceita "1", "1️⃣", "opção 1", "a 2" e o nome da
// opção ("usados" → "Tratores Usados"). Número fora da faixa ou mais de um número = não entendeu.
export function parseMenuAnswer(answer: string, options: ChatbotOption[]): number | null {
  const raw = (answer || "").trim();
  if (!raw) return null;
  const numbers = raw.match(/\d+/g);
  if (numbers && numbers.length === 1) {
    const n = Number(numbers[0]);
    if (n >= 1 && n <= options.length) return n - 1;
  }
  const a = key(raw);
  if (!a) return null;
  const exact = options.findIndex((o) => key(o.label) === a);
  if (exact >= 0) return exact;
  // Parcial só com palavra de verdade (3+ letras) e só se apontar pra UMA opção — "tratores" bate em
  // "Tratores Novos" e "Tratores Usados", aí é melhor perguntar de novo do que chutar.
  if (a.length < 3) return null;
  const partial = options.map((o, i) => ({ i, k: key(o.label) })).filter(({ k }) => k.includes(a) || a.includes(k));
  return partial.length === 1 ? partial[0].i : null;
}

// ── Sequência de etapas ────────────────────────────────────────────────────

// A partir de `from`, o que mandar agora: as etapas "mensagem" em sequência mais a próxima que espera
// resposta. `waitingIndex` null = acabaram as etapas (hora da mensagem final).
export function planFrom(steps: ChatbotStep[], from: number): { texts: string[]; waitingIndex: number | null } {
  const texts: string[] = [];
  for (let i = from; i < steps.length; i++) {
    texts.push(renderStepText(steps[i]));
    if (steps[i].type !== "message") return { texts, waitingIndex: i };
  }
  return { texts, waitingIndex: null };
}

export const OPT_OUT_RE = /^\s*(sair|parar|pare|stop|cancelar|descadastrar)\s*[.!]*\s*$/i;

// ── Modelos prontos ────────────────────────────────────────────────────────

export type ChatbotTemplate = { key: string; label: string; config: ChatbotConfig };

const opt = (label: string, extra: Partial<ChatbotOption> = {}): ChatbotOption => ({ label, tag: label, fieldKey: "", fieldValue: "", stage: "", ...extra });

export const CHATBOT_TEMPLATES: ChatbotTemplate[] = [
  {
    key: "cidade-interesse",
    label: "Luchini — cidade + interesse",
    config: {
      enabled: false,
      steps: [
        {
          id: "cidade",
          type: "question",
          text: "Oi! Aqui é a Letícia da Luchini Tratores e vou cuidar do seu atendimento hoje.\nPra eu conseguir te direcionar certinho, de qual cidade você é?",
          fieldKey: "cidade",
          saveAsTag: false,
        },
        {
          id: "interesse",
          type: "menu",
          text: "Perfeito, como podemos te ajudar hoje {{primeiro_nome}}?",
          options: [opt("Tratores Novos"), opt("Tratores Usados"), opt("Implementos"), opt("Peças e oficina"), opt("Outros")],
        },
      ],
      finalMessage: "Obrigada, {{primeiro_nome}}! Já vou te colocar em contato com um consultor da nossa loja 😊",
    },
  },
  {
    key: "boas-vindas-setores",
    label: "Boas-vindas + setores",
    config: {
      enabled: false,
      steps: [
        { id: "boas-vindas", type: "message", text: "Olá, {{primeiro_nome}}! Obrigado pelo contato 😊" },
        { id: "setor", type: "menu", text: "Com qual setor você quer falar?", options: [opt("Comercial"), opt("Suporte"), opt("Financeiro")] },
      ],
      finalMessage: "Perfeito! Já vou te encaminhar pra nossa equipe.",
    },
  },
];
