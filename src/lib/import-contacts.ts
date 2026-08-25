// Parsing de planilha (CSV/XLSX) de contatos — adaptado do importer usado no piloto da Hanoi.
import * as XLSX from "xlsx";

function clean(v: unknown): string {
  return String(v ?? "").replace(/^'+|'+$/g, "").trim();
}

// Normaliza telefone pra dígitos com DDI 55 (formato que a Evolution API espera).
export function normalizePhone(raw: unknown): string | null {
  let digits = clean(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("0")) digits = digits.replace(/^0+/, "");
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return null;
}

// O "9º dígito" do celular brasileiro é ambíguo entre sistemas: a Meta às vezes reporta o número de
// quem respondeu SEM o 9 (55+DDD+8 dígitos = 12 no total) mesmo quando o contato foi importado/salvo
// COM o 9 (55+DDD+9+8 = 13), ou vice-versa. Sem tratar isso, uma resposta de lead de campanha não bate
// com o telefone já salvo e vira um contato novo/duplicado em vez de continuar a mesma conversa. Usado
// só como 2ª tentativa de busca (fallback), nunca pra decidir qual é o formato "certo" pra salvar.
export function brPhoneVariant(phone: string): string | null {
  if (!/^55\d{10,11}$/.test(phone)) return null;
  const ddd = phone.slice(2, 4);
  const rest = phone.slice(4);
  if (rest.length === 9 && rest[0] === "9") return `55${ddd}${rest.slice(1)}`;
  if (rest.length === 8) return `55${ddd}9${rest}`;
  return null;
}

function findColumn(headers: string[], candidates: string[]): string | undefined {
  return headers.find((h) => {
    const cleanH = clean(h).toLowerCase();
    return candidates.some((c) => cleanH.includes(c));
  });
}

export type ParsedContact = {
  name: string;
  phone: string | null;
  email: string;
};

export type ParseResult = {
  contacts: ParsedContact[];
  total: number;
  skippedNoPhoneOrEmail: number;
  error?: string;
};

export function parseContactsFile(buffer: Buffer): ParseResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });

  if (rows.length === 0) return { contacts: [], total: 0, skippedNoPhoneOrEmail: 0, error: "Planilha vazia." };

  const headers = Object.keys(rows[0]);
  const colName = findColumn(headers, ["nome", "name", "cliente", "contato"]);
  const colPhone = findColumn(headers, ["telefone", "phone", "celular", "whatsapp", "fone", "mobile"]);
  const colEmail = findColumn(headers, ["e-mail", "email", "mail"]);

  if (!colPhone && !colEmail) {
    return {
      contacts: [],
      total: rows.length,
      skippedNoPhoneOrEmail: 0,
      error: `Não encontrei coluna de telefone nem de e-mail. Cabeçalhos: ${headers.join(" | ")}`,
    };
  }

  const contacts: ParsedContact[] = [];
  let skipped = 0;

  for (const row of rows) {
    const phone = colPhone ? normalizePhone(row[colPhone]) : null;
    const email = colEmail ? clean(row[colEmail]) : "";
    if (!phone && !email) {
      skipped++;
      continue;
    }
    contacts.push({
      name: colName ? clean(row[colName]) : "",
      phone,
      email,
    });
  }

  return { contacts, total: rows.length, skippedNoPhoneOrEmail: skipped };
}
