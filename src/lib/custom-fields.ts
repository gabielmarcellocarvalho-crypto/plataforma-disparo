// Campos personalizados com esquema — a definição vive em `custom_field_defs` (migration 0063) e o
// valor continua em `contacts.custom_fields` (jsonb). Este arquivo é a fonte única de como um valor
// é normalizado, validado e exibido, pra tabela, card, drawer e filtro concordarem entre si.

export type CustomFieldType = "texto" | "texto_longo" | "numero" | "data" | "selecao" | "selecao_multipla";

export const CUSTOM_FIELD_TYPES: { key: CustomFieldType; label: string; hint: string }[] = [
  { key: "texto", label: "Texto", hint: "linha única — nome de contato, código, placa" },
  { key: "texto_longo", label: "Texto longo", hint: "várias linhas — observações" },
  { key: "numero", label: "Número", hint: "valor, quantidade" },
  { key: "data", label: "Data", hint: "dia/mês/ano" },
  { key: "selecao", label: "Lista (escolhe 1)", hint: "opções fixas — produto, campanha, cidade" },
  { key: "selecao_multipla", label: "Lista (escolhe várias)", hint: "opções fixas, mais de uma por lead" },
];

export type CustomFieldDef = {
  id: string;
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  show_in_table: boolean;
  show_in_card: boolean;
  position: number;
};

export function isCustomFieldType(v: unknown): v is CustomFieldType {
  return typeof v === "string" && CUSTOM_FIELD_TYPES.some((t) => t.key === v);
}

// A chave é derivada do rótulo na criação e nunca muda depois — renomear a chave órfãnaria todos os
// valores já gravados nos leads. Sem acento, sem espaço, sem maiúscula: é o que vai pro jsonb e pro
// nome de coluna em exportação.
export function normalizeFieldKey(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

// Aceita o que o banco devolver: `options` pode vir como array já parseado (jsonb) ou nulo.
export function parseOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    const s = String(v ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s.slice(0, 80));
  }
  return out;
}

// Valor multi-seleção é gravado como array; o resto como string. Ler tolera os dois formatos porque
// o mesmo campo pode ter sido preenchido antes de virar multi (ou pelo agente de IA, que só escreve
// texto via a tag [[DADOS: chave=valor]]).
export function readMultiValue(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v ?? "").trim()).filter(Boolean);
  const s = String(raw ?? "").trim();
  if (!s) return [];
  return s.split(",").map((v) => v.trim()).filter(Boolean);
}

// Texto pra exibir em tabela, card e filtro. Data sai em pt-BR; número sai como veio (o cliente pode
// estar guardando "1.500" ou "1500", não é hora de opinar).
export function formatFieldValue(def: Pick<CustomFieldDef, "type">, raw: unknown): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (def.type === "selecao_multipla") return readMultiValue(raw).join(", ");
  const s = String(raw).trim();
  if (def.type === "data") {
    // Só formata o que é de fato uma data ISO; qualquer outra coisa passa reto em vez de virar
    // "Invalid Date" na tela.
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  return s;
}

// Validação na hora de salvar um lead. Devolve a mensagem de erro ou null.
export function validateFieldValue(def: CustomFieldDef, raw: unknown): string | null {
  const isMulti = def.type === "selecao_multipla";
  const values = isMulti ? readMultiValue(raw) : [String(raw ?? "").trim()].filter(Boolean);

  if (def.required && values.length === 0) return `"${def.label}" é obrigatório.`;
  if (values.length === 0) return null;

  if (def.type === "numero" && !/^-?\d+([.,]\d+)?$/.test(values[0])) return `"${def.label}" precisa ser um número.`;
  if (def.type === "data" && !/^\d{4}-\d{2}-\d{2}$/.test(values[0])) return `"${def.label}" precisa ser uma data válida.`;
  if ((def.type === "selecao" || isMulti) && def.options.length > 0) {
    const invalid = values.find((v) => !def.options.includes(v));
    if (invalid) return `"${invalid}" não é uma opção de "${def.label}".`;
  }
  return null;
}

// Monta o jsonb final a partir do que veio do formulário.
//
// Chave sem definição NÃO é descartada: antes desse sistema o time digitava chave/valor livre em cada
// lead, e o agente de IA continua gravando o que coletar via [[DADOS: chave=valor]] sem pedir licença.
// Apagar isso silenciosamente ao salvar um lead seria perda de dado do cliente.
export function buildCustomFields(
  defs: CustomFieldDef[],
  formValues: Record<string, unknown>,
  extras: Record<string, unknown> = {}
): { values: Record<string, string | string[]>; error: string | null } {
  const out: Record<string, string | string[]> = {};

  for (const def of defs) {
    const raw = formValues[def.key];
    const error = validateFieldValue(def, raw);
    if (error) return { values: {}, error };

    if (def.type === "selecao_multipla") {
      const list = readMultiValue(raw);
      if (list.length > 0) out[def.key] = list;
    } else {
      const s = String(raw ?? "").trim();
      if (s) out[def.key] = s;
    }
  }

  const known = new Set(defs.map((d) => d.key));
  for (const [k, v] of Object.entries(extras)) {
    const key = k.trim();
    if (!key || known.has(key)) continue;
    if (Array.isArray(v)) {
      const list = readMultiValue(v);
      if (list.length > 0) out[key] = list;
    } else {
      const s = String(v ?? "").trim();
      if (s) out[key] = s;
    }
  }

  return { values: out, error: null };
}

// Separa, dos valores já gravados num lead, o que tem definição do que é herança livre — o drawer
// mostra os dois em seções diferentes.
export function splitKnownAndExtras(
  defs: CustomFieldDef[],
  stored: Record<string, unknown> | null
): { known: Record<string, unknown>; extras: { key: string; value: string }[] } {
  const known: Record<string, unknown> = {};
  const extras: { key: string; value: string }[] = [];
  const byKey = new Map(defs.map((d) => [d.key, d]));

  for (const [k, v] of Object.entries(stored || {})) {
    if (byKey.has(k)) known[k] = v;
    else extras.push({ key: k, value: Array.isArray(v) ? readMultiValue(v).join(", ") : String(v ?? "") });
  }
  return { known, extras };
}
