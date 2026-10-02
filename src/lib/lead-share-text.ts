// Texto pronto pra colar no WhatsApp com os dados de um lead — é o botão "Copiar dados" do painel do
// lead, usado pra repassar o contato pra vendedor/outra pessoa. Formatação do próprio WhatsApp
// (*negrito*), uma informação por linha, e só o que estiver preenchido (nada de "E-mail: —").
import { formatFieldValue, type CustomFieldDef } from "@/lib/custom-fields";

export type LeadShareInput = {
  name: string;
  phone: string;
  email: string;
  stageName: string | null;
  teamMemberName: string | null;
  branchName: string | null;
  tags: string[];
  lostReason: string | null;
  // Campos com definição no workspace (rótulo bonito) e os soltos (chave crua, formato antigo/IA).
  fieldDefs: Pick<CustomFieldDef, "key" | "label" | "type">[];
  values: Record<string, unknown>;
  extras: { key: string; value: string }[];
};

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const m = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : raw.trim();
}

export function buildLeadShareText(input: LeadShareInput): string {
  const lines: string[] = [];
  const add = (label: string, value: string | null | undefined) => {
    const v = (value ?? "").trim();
    if (v) lines.push(`${label}: ${v}`);
  };

  lines.push(`*${input.name.trim() || "Lead sem nome"}*`);
  const digits = input.phone.replace(/\D/g, "");
  add("Telefone", input.phone ? formatPhone(input.phone) : "");
  // Link que abre a conversa direto — o vendedor só toca e fala com o lead.
  if (digits.length >= 10) lines.push(`WhatsApp: https://wa.me/${digits}`);
  add("E-mail", input.email);
  add("Etapa", input.stageName);
  add("Motivo da perda", input.lostReason);
  add("Vendedor", input.teamMemberName);
  add("Filial", input.branchName);
  add("Etiquetas", input.tags.join(", "));

  for (const def of input.fieldDefs) {
    add(def.label, formatFieldValue(def, input.values[def.key]));
  }
  for (const extra of input.extras) {
    if (extra.key.trim()) add(extra.key.trim(), extra.value);
  }

  return lines.join("\n");
}
