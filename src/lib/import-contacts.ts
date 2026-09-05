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

// ── Importação com mapeamento de colunas ──────────────────────────────────
// Antes o importador só sabia ler nome/telefone/e-mail da PRIMEIRA aba, e jogava fora todo o resto.
// A planilha real de um cliente de CRM tem cidade, produto, campanha, filial, vendedor e status —
// e costuma ter várias abas, sendo a de leads raramente a primeira. Daí o de/para: quem importa diz
// o que é cada coluna, e o destino pode ser um campo personalizado do workspace.

// Alvo de cada coluna. `campo:<key>` aponta pra um custom_field_defs.key do workspace.
export type ImportTarget =
  | "ignorar"
  | "nome"
  | "telefone"
  | "email"
  | "responsavel"
  | "filial"
  | "etapa"
  | "motivo_perda"
  | `campo:${string}`;

export type SheetPreview = {
  sheets: string[];
  sheet: string;
  headers: string[];
  sample: string[][];
  total: number;
  error?: string;
};

function readRows(buffer: Buffer, sheetName?: string) {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const nome = sheetName && wb.SheetNames.includes(sheetName) ? sheetName : wb.SheetNames[0];
  const grade = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, defval: null, raw: true, blankrows: false });
  return { sheets: wb.SheetNames, sheet: nome, grade };
}

// Cabeçalho vazio ou repetido quebraria o de/para (duas colunas com a mesma chave). Coluna sem
// título vira "Coluna D" — a planilha da Luchini tem exatamente isso na coluna do responsável.
function nomearColunas(primeira: unknown[]): string[] {
  const vistos = new Map<string, number>();
  return primeira.map((v, i) => {
    let nome = clean(v) || `Coluna ${XLSX.utils.encode_col(i)}`;
    const repetido = vistos.get(nome) ?? 0;
    vistos.set(nome, repetido + 1);
    if (repetido > 0) nome = `${nome} (${repetido + 1})`;
    return nome;
  });
}

function celulaTexto(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return clean(v);
}

export function inspectSheet(buffer: Buffer, sheetName?: string): SheetPreview {
  const { sheets, sheet, grade } = readRows(buffer, sheetName);
  if (grade.length === 0) return { sheets, sheet, headers: [], sample: [], total: 0, error: "Essa aba está vazia." };

  const headers = nomearColunas(grade[0]);
  const corpo = grade.slice(1).filter((linha) => linha.some((c) => celulaTexto(c) !== ""));
  return {
    sheets,
    sheet,
    headers,
    sample: corpo.slice(0, 5).map((linha) => headers.map((_, i) => celulaTexto(linha[i]))),
    total: corpo.length,
  };
}

// Chuta o de/para pelo nome do cabeçalho, pra quem importa só conferir em vez de preencher tudo.
export function suggestMapping(headers: string[], campos: { key: string; label: string }[]): Record<string, ImportTarget> {
  const chute: Record<string, ImportTarget> = {};
  const usados = new Set<ImportTarget>();

  const marcar = (header: string, alvo: ImportTarget) => {
    // Alvo padrão só pode ser usado uma vez: duas colunas viraram "nome" e a segunda sobrescreveria
    // a primeira sem ninguém perceber.
    if (usados.has(alvo)) return;
    chute[header] = alvo;
    usados.add(alvo);
  };

  for (const h of headers) {
    const t = h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (/telefone|celular|whatsapp|fone|mobile|phone/.test(t)) marcar(h, "telefone");
    else if (/e-?mail/.test(t)) marcar(h, "email");
    else if (/nome|cliente|contato|name/.test(t)) marcar(h, "nome");
    else if (/vendedor|responsavel|consultor|atendente/.test(t)) marcar(h, "responsavel");
    else if (/filial|loja|unidade/.test(t)) marcar(h, "filial");
    else if (/status|etapa|fase|estagio/.test(t)) marcar(h, "etapa");
    else if (/motivo/.test(t)) marcar(h, "motivo_perda");
    else {
      const campo = campos.find((c) => {
        const l = c.label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return l === t || c.key === t.replace(/[^a-z0-9]+/g, "_");
      });
      if (campo) marcar(h, `campo:${campo.key}`);
    }
  }

  for (const h of headers) if (!chute[h]) chute[h] = "ignorar";
  return chute;
}

export type MappedRow = {
  name: string;
  phone: string | null;
  email: string;
  responsavel: string;
  filial: string;
  etapa: string;
  motivoPerda: string;
  campos: Record<string, string>;
};

export type MappedParse = {
  rows: MappedRow[];
  total: number;
  skippedNoPhoneOrEmail: number;
  error?: string;
};

export function parseWithMapping(buffer: Buffer, sheetName: string, mapping: Record<string, ImportTarget>): MappedParse {
  const { grade } = readRows(buffer, sheetName);
  if (grade.length === 0) return { rows: [], total: 0, skippedNoPhoneOrEmail: 0, error: "Essa aba está vazia." };

  const headers = nomearColunas(grade[0]);
  const alvos = headers.map((h) => mapping[h] ?? "ignorar");
  if (!alvos.includes("telefone") && !alvos.includes("email")) {
    return { rows: [], total: 0, skippedNoPhoneOrEmail: 0, error: "Aponte pelo menos uma coluna pra Telefone ou E-mail." };
  }

  const corpo = grade.slice(1).filter((linha) => linha.some((c) => celulaTexto(c) !== ""));
  const rows: MappedRow[] = [];
  let puladas = 0;

  for (const linha of corpo) {
    const row: MappedRow = { name: "", phone: null, email: "", responsavel: "", filial: "", etapa: "", motivoPerda: "", campos: {} };
    for (let i = 0; i < alvos.length; i++) {
      const alvo = alvos[i];
      if (alvo === "ignorar") continue;
      const valor = celulaTexto(linha[i]);
      if (!valor) continue;

      if (alvo === "nome") row.name = valor;
      else if (alvo === "telefone") row.phone = normalizePhone(valor);
      else if (alvo === "email") row.email = valor;
      else if (alvo === "responsavel") row.responsavel = valor;
      else if (alvo === "filial") row.filial = valor;
      else if (alvo === "etapa") row.etapa = valor;
      else if (alvo === "motivo_perda") row.motivoPerda = valor;
      else if (alvo.startsWith("campo:")) row.campos[alvo.slice(6)] = valor;
    }

    // Contato sem telefone e sem e-mail não tem como ser contatado nem deduplicado — mesma regra
    // do importador antigo.
    if (!row.phone && !row.email) {
      puladas++;
      continue;
    }
    rows.push(row);
  }

  return { rows, total: corpo.length, skippedNoPhoneOrEmail: puladas };
}
