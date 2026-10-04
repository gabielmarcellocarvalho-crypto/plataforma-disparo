// Valor de um campo da lista de contatos pra preencher uma variável de template ({{1}}, {{2}}…).
// Compartilhado entre automação (workflow) e follow-up do agente, pra que os dois preencham igual.
export type TemplateFieldContact = {
  name: string | null;
  phone: string | null;
  email?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export function fieldValue(field: string, contact: TemplateFieldContact, companyName: string | null): string {
  if (field === "name") return contact.name || "";
  if (field === "company") return companyName || "";
  if (field === "phone") return contact.phone || "";
  if (field === "email") return contact.email || "";
  if (field.startsWith("cf:")) {
    const v = contact.custom_fields?.[field.slice(3)];
    return v == null ? "" : String(v);
  }
  return "";
}
