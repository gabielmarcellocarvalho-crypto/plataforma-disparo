// Transforma os campos de um lead do Facebook (field_data) nos dados do lead da plataforma.
// Função pura: quem grava é o webhook. Campos padrão da Meta viram nome/telefone/e-mail; qualquer outra
// pergunta do formulário vira campo personalizado, com o nome da pergunta como chave.
import { normalizeFieldKey } from "@/lib/custom-fields";

export type FacebookField = { name: string; values: string[] };

export type MappedFacebookLead = {
  name: string | null;
  phone: string | null;
  email: string | null;
  // Campos personalizados (chave = nome da pergunta normalizado).
  custom: Record<string, string>;
  // Valor de cidade, pra o roteamento por território. Null se o formulário não perguntou.
  city: string | null;
};

const NAME_KEYS = new Set(["full_name", "nome_completo", "nome", "name"]);
const PHONE_KEYS = new Set(["phone_number", "phone", "telefone", "celular", "whatsapp"]);
const EMAIL_KEYS = new Set(["email", "e_mail", "e-mail"]);

export function mapFacebookFields(fields: FacebookField[]): MappedFacebookLead {
  let fullName = "";
  let firstName = "";
  let lastName = "";
  let phone: string | null = null;
  let email: string | null = null;
  let city: string | null = null;
  const custom: Record<string, string> = {};

  for (const field of fields || []) {
    const raw = field.name.trim();
    const key = raw.toLowerCase();
    const value = (field.values?.[0] ?? "").trim();
    if (!value) continue;

    if (NAME_KEYS.has(key)) fullName = value;
    else if (key === "first_name") firstName = value;
    else if (key === "last_name") lastName = value;
    else if (PHONE_KEYS.has(key)) phone = value;
    else if (EMAIL_KEYS.has(key)) email = value;
    else {
      const customKey = normalizeFieldKey(raw);
      if (customKey) custom[customKey] = value;
      if (!city && /cidade|city/.test(key)) city = value;
    }
  }

  const name = fullName || [firstName, lastName].filter(Boolean).join(" ") || null;
  return { name, phone, email, custom, city };
}
