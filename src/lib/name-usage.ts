// Evita o agente chamar o cliente pelo nome em toda frase ("Entendi, Lorenzo", "Que bacana, Lorenzo").
// Instrução de prompt sozinha o modelo esquece; aqui a decisão sai do histórico: se o nome apareceu em
// alguma das últimas respostas do agente, esta resposta não pode usar.
type Msg = { role: string; content: string };

const RECENT_REPLIES = 4;

const fold = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function nameRecentlyUsed(name: string | null | undefined, history: Msg[]): boolean {
  const first = fold((name || "").trim().split(/\s+/)[0] || "");
  if (first.length < 2) return false;
  const re = new RegExp(`(^|[^a-z0-9])${first.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`);
  return history
    .filter((m) => m.role === "assistant")
    .slice(-RECENT_REPLIES)
    .some((m) => re.test(fold(m.content)));
}

export function nameUsageNote(name: string | null | undefined, history: Msg[]): string {
  if (!(name || "").trim()) return "";
  return nameRecentlyUsed(name, history)
    ? " NÃO use o nome do cliente nesta resposta: você já o chamou pelo nome há pouco. Responda sem nome."
    : " Use o nome do cliente com moderação: no máximo uma vez a cada várias mensagens (ex.: na saudação ou num momento de ênfase), nunca em toda frase.";
}
