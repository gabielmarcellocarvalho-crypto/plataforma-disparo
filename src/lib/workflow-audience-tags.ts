import { normalizeTags } from "@/lib/contact-tags";

// Filtro de público por tag das automações. "any" = tem pelo menos uma das tags marcadas; "all" = tem todas.
// `excludeTags` tira quem tem qualquer uma delas. Sem nenhuma tag configurada, não filtra nada.
export type TagAudience = { tags?: unknown; tagMode?: unknown; excludeTags?: unknown };

const fold = (v: string) => v.normalize("NFD").replace(new RegExp("[\u0300-\u036f]", "g"), "").toLowerCase();

export function hasTagAudience(a: TagAudience): boolean {
  return normalizeTags(a.tags).length > 0 || normalizeTags(a.excludeTags).length > 0;
}

export function matchesTagAudience(contactTags: unknown, a: TagAudience): boolean {
  const include = normalizeTags(a.tags).map(fold);
  const exclude = normalizeTags(a.excludeTags).map(fold);
  if (include.length === 0 && exclude.length === 0) return true;
  const has = new Set(normalizeTags(contactTags).map(fold));
  if (exclude.some((t) => has.has(t))) return false;
  if (include.length === 0) return true;
  return a.tagMode === "all" ? include.every((t) => has.has(t)) : include.some((t) => has.has(t));
}
