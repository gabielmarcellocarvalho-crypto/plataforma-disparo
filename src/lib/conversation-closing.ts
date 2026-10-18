// Fim de conversa: quando o cliente só se despede/agradece e o agente já tinha se despedido, responder de
// novo gera o "tchau de volta pro tchau" sem fim — e cada resposta é uma chamada paga de IA. Aqui a decisão
// é por regra (sem IA): nesses casos o agente só reage com um joinha, ou fica em silêncio.

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase();

// Palavras de despedida / agradecimento / "ok" do cliente.
const CLOSING_WORDS = new Set([
  "tchau", "xau", "ate", "mais", "logo", "amanha", "breve", "valeu", "vlw", "obrigado", "obrigada", "obg", "brigado", "brigada",
  "blz", "beleza", "ok", "okay", "certo", "fechado", "combinado", "show", "perfeito", "otimo", "tmj", "abraco", "abracos", "flw",
  "falou", "disponha", "imagina", "nada", "amem", "abencoe", "deus", "obgd", "agradeco", "grato", "grata",
]);
// Palavras de enchimento permitidas ao lado delas (nenhuma muda o sentido para pedido ou pergunta).
const FILLER_WORDS = new Set([
  "muito", "mt", "mto", "e", "a", "o", "de", "pra", "para", "voce", "vc", "tambem", "tb", "ai", "ta", "tudo", "bem", "entao", "um",
  "uma", "dia", "noite", "tarde", "fim", "semana", "bom", "boa", "otima", "otimo", "ate", "la", "se", "cuida", "cuide", "fique",
  "com", "sua", "seu", "equipe", "gente", "por", "tudo", "isso", "mesmo", "demais", "super",
]);
const CLOSING_EMOJIS = ["👍", "🙏", "😊", "❤", "👏", "🤝", "✌", "👋", "😉", "🙌"];

export function isClosingMessage(text: string): boolean {
  const raw = (text || "").trim();
  if (!raw || raw.length > 60 || raw.includes("?")) return false;
  const words = fold(raw)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  // Só emoji de agradecimento/joinha (sem nenhuma palavra).
  if (words.length === 0) return CLOSING_EMOJIS.some((e) => raw.includes(e));
  if (words.length > 6) return false;
  if (words.some((w) => /\d/.test(w))) return false;
  if (!words.some((w) => CLOSING_WORDS.has(w))) return false;
  return words.every((w) => CLOSING_WORDS.has(w) || FILLER_WORDS.has(w));
}

// A última fala do agente foi uma despedida clara? Saudação ("boa tarde") NÃO conta: abre conversa, não encerra.
const FAREWELL_PATTERNS = [
  /\btchau\b/,
  /\bate (mais|logo|amanha|breve|a proxima)\b/,
  /\bqualquer coisa (e so|me chama|me chame|chama|chame)/,
  /\be so (me )?chamar\b/,
  /\bfico (por aqui|a disposicao)\b/,
  /\bestou a disposicao\b/,
  /\bdisponha\b/,
  /\b(de|por) nada\b/,
  /\bbom descanso\b/,
  /\btenha um(a)? (otim|excelente|bom|boa|lind)/,
  /\bfoi um prazer\b/,
  /\bum abraco\b/,
];

export function isFarewellFromAgent(text: string | null | undefined): boolean {
  const t = fold((text || "").trim());
  if (!t || t.length > 220 || t.includes("?")) return false;
  return FAREWELL_PATTERNS.some((re) => re.test(t));
}

export function shouldReactInsteadOfReply(userText: string | null | undefined, lastAssistantText: string | null | undefined): boolean {
  return isClosingMessage(userText || "") && isFarewellFromAgent(lastAssistantText);
}

// Reações que o agente pode usar (a Meta aceita qualquer emoji, mas aqui vale só o que combina com atendimento).
const ALLOWED_REACTIONS = ["👍", "❤️", "🙏", "😊", "👏"];

export function normalizeReaction(raw: string | null | undefined): string | null {
  const s = (raw || "").trim();
  if (!s) return null;
  const match = ALLOWED_REACTIONS.find((e) => s.startsWith(e) || s.startsWith(e.replace("️", "")));
  return match ?? null;
}

export const REACAO_TAG = /\[\[REACAO:\s*([^\]]{1,12}?)\s*\]\]/i;

export function parseReaction(text: string): string | null {
  const m = text.match(REACAO_TAG);
  return m ? normalizeReaction(m[1]) : null;
}

// Conversa longa que não avançou: o agente passa a responder curto (corta o gasto de tokens com papo que
// não vira venda). Só olha o histórico recente que o agente já carrega.
const LONG_CHAT_REPLIES = 12;

export function isLongStalledChat(history: { role: string }[], stage: string | null | undefined): boolean {
  if (stage !== "nao_abordado" && stage !== "abordado") return false;
  return history.filter((m) => m.role === "assistant").length >= LONG_CHAT_REPLIES;
}

export const LONG_CHAT_BLOCK =
  "\n\nEsta conversa já está longa e o cliente ainda não demonstrou interesse real em comprar. Responda de forma MUITO curta " +
  "(uma frase), não puxe assunto novo e não entre em conversa pessoal ou fora do tema (redes sociais, vida pessoal, pedido para o " +
  "atendente seguir ou adicionar alguém, brincadeiras). Agradeça com educação, em poucas palavras, e traga de volta, em uma " +
  "pergunta objetiva, para o que a empresa vende.";

// Regras de conversa do tom humanizado. Entram na hora de responder (não no prompt salvo), então valem
// também para os agentes humanizados que já existem, sem ninguém precisar regerar o prompt.
export const HUMANIZADO_CONVERSATION_BLOCK =
  "\n\nInteligência de conversa (tom humanizado):\n" +
  "- Despedida: se o cliente se despedir ou agradecer (\"tchau\", \"valeu\", \"obrigado\") e você ainda não se despediu, responda com UMA " +
  "despedida curta. Se você já se despediu, NÃO repita despedida nem \"até mais\": responda apenas com [[REACAO: 👍]] e nenhum texto.\n" +
  "- Reação: quando uma resposta em texto seria só enchimento (\"ok\", \"show\", agradecimento depois de você já ter resolvido), em vez de " +
  "escrever, reaja à mensagem do cliente com [[REACAO: 👍]] (ou ❤️, 🙏, 😊, 👏) e não escreva texto. Nunca reaja a pergunta ou pedido. " +
  "A regra de não usar emojis vale para o texto; a reação é a única exceção.\n" +
  "- Fora do assunto: se o cliente puxar assunto que nada tem a ver com a empresa (pedir para você segui-lo no Instagram, conversa pessoal, " +
  "brincadeira), responda uma vez, de forma simpática e curta, e volte ao assunto. Se ele insistir, responda ainda mais curto e não alimente o papo.";

// O agente conversa pelo WhatsApp do próprio cliente, então o número já é conhecido. Sem essa regra o
// modelo pedia "seu número com DDD pra eu te ligar" (campo "telefone" na coleta + modo SDR puxando pra
// ligação). Entra na hora de responder, então vale pra todos os agentes sem regerar o prompt.
export const PHONE_KNOWN_BLOCK =
  "\n\nTelefone do cliente: você já tem o número dele, é o deste WhatsApp em que vocês estão conversando. NUNCA peça " +
  "telefone, número com DDD ou outro contato pra ligar. Não proponha ligação por conta própria; se o cliente fizer uma " +
  "pergunta (preço, tamanho, entrega), responda a pergunta aqui mesmo na conversa. Se o próprio cliente pedir pra receber " +
  "uma ligação, confirme que vão ligar neste mesmo número, pergunte só o melhor horário e sinalize a equipe com " +
  "[[PRECISA_HUMANO]]. Se houver um campo telefone a registrar, ele já é o número deste WhatsApp: não pergunte.";
