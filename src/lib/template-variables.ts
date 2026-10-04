// Mapeamento das variáveis do template ({{1}}, {{2}}…) pros campos reais da lista de contatos do workspace.
// Os campos são os mesmos que as mensagens já aceitam ({nome}, {empresa}, campos personalizados): assim o
// que a tela mostra é exatamente o que vai ser preenchido no envio.
import type { CustomFieldDef } from "@/lib/custom-fields";

export type TemplateField = {
  value: string; // "name" | "company" | "phone" | "email" | "cf:<key>"
  label: string; // como aparece pro usuário
  example: string; // valor de exemplo (aparece na prévia e vai pra Meta como amostra)
};

export const BUILTIN_FIELDS: TemplateField[] = [
  { value: "name", label: "Nome", example: "Maria" },
  { value: "company", label: "Empresa", example: "Acme Ltda" },
  { value: "phone", label: "Telefone", example: "5511999998888" },
  { value: "email", label: "E-mail", example: "maria@acme.com.br" },
];

// Campos do workspace: os fixos + os personalizados cadastrados nele (cada um vira uma opção).
export function fieldOptionsFor(defs: CustomFieldDef[]): TemplateField[] {
  const custom = defs.map((d) => ({
    value: `cf:${d.key}`,
    label: d.label,
    example: d.options[0] || d.label,
  }));
  return [...BUILTIN_FIELDS, ...custom];
}

// Quantas variáveis o texto tem (maior número usado: {{3}} implica 3).
export function variableCount(text: string): number {
  const nums = [...text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  return nums.length ? Math.max(...nums) : 0;
}

// Prévia do texto com o exemplo de cada campo escolhido. Variável sem campo fica como {{n}}.
export function previewText(text: string, mapping: string[], options: TemplateField[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (original, n: string) => {
    const field = options.find((o) => o.value === mapping[Number(n) - 1]);
    return field ? field.example : original;
  });
}

// "{{1}} = Nome" etc., pra legenda abaixo do texto e pra lista de templates.
export function mappingLegend(mapping: string[], options: TemplateField[]): string[] {
  return mapping.map((value, i) => {
    const field = options.find((o) => o.value === value);
    return `{{${i + 1}}} = ${field ? field.label : "não escolhido"}`;
  });
}

// Valida o mapeamento contra as opções reais do workspace (não confia no que veio do formulário).
export function validateMapping(count: number, mapping: string[], options: TemplateField[]): string | null {
  if (mapping.length < count) return "Escolha um campo para cada variável.";
  for (let i = 0; i < count; i++) {
    if (!options.some((o) => o.value === mapping[i])) return `A variável {{${i + 1}}} não corresponde a um campo deste workspace.`;
  }
  return null;
}
