// Tags de contato e de campanha (migration 0073). Fonte única de como uma tag é normalizada, pra
// tela, importação de planilha e herança automática no disparo concordarem entre si — sem isso,
// "Associado", "associado " e "ASSOCIADO" virariam três tags diferentes na mesma base.

export const MAX_TAGS_PER_CONTACT = 30;
const MAX_TAG_LENGTH = 40;

// Marcas de acento, pra deduplicar "Sócio" contra "socio". Escrita com \u pra não depender de o
// arquivo chegar em UTF-8 em toda ferramenta que passar por ele.
const DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

// Normaliza uma tag: colapsa espaço, corta no limite. Maiúscula/minúscula é PRESERVADA (a tag é
// rótulo de tela, "Aquecimento" tem que aparecer assim) — a deduplicação é que ignora caixa.
export function normalizeTag(raw: unknown): string | null {
  const s = String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAG_LENGTH);
  return s || null;
}

// Chave de comparação: sem acento, sem caixa. Nunca é gravada — só decide se duas tags são a mesma.
function tagKey(tag: string): string {
  return tag.normalize("NFD").replace(DIACRITICS, "").toLowerCase();
}

// Lista limpa: normaliza, remove vazio, remove repetida (ignorando caixa e acento) e corta no teto
// por contato. Aceita array ou string separada por vírgula/ponto-e-vírgula (é o que vem da planilha).
export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[;,]/) : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const tag = normalizeTag(item);
    if (!tag) continue;
    const key = tagKey(tag);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_CONTACT) break;
  }
  return out;
}

// União de duas listas, preservando a ordem da primeira — é o que a herança de tag da campanha usa:
// quem já tinha [Associado] e recebe a campanha [Aquecimento] fica com os dois, sem duplicar o que
// já estava lá.
export function mergeTags(current: unknown, incoming: unknown): string[] {
  return normalizeTags([...normalizeTags(current), ...normalizeTags(incoming)]);
}

// Literal de array do Postgres pro DSL de filtro do PostgREST (`tags=ov.{a,"b c"}`). Aspas duplas e
// barra invertida precisam de escape — uma tag com vírgula ("Evento, SP") sem isso vira duas tags na
// query e o filtro passa a segmentar algo diferente do que a tela mostrou.
export function toPostgrestArrayLiteral(tags: string[]): string {
  const parts = tags.map((t) => `"${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  return `{${parts.join(",")}}`;
}
