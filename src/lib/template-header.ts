// Template aprovado com cabeçalho de mídia (imagem/documento). A Meta exige a mídia em CADA envio: a
// imagem que o dono anexou ao criar o template na Meta só serve de exemplo pra aprovação. Sem ela, o
// envio falha com #132012 "header: Format mismatch, expected IMAGE, received UNKNOWN".

export type HeaderMediaFormat = "IMAGE" | "DOCUMENT";

type Rule = { label: string; accept: string; mimes: string[]; maxBytes: number };

// Limites da Meta: imagem só JPEG/PNG até 5MB; documento PDF. Vídeo fica de fora desta versão: o
// bucket "conversation-media" só aceita imagem, áudio e PDF.
const RULES: Record<HeaderMediaFormat, Rule> = {
  IMAGE: { label: "imagem (JPG ou PNG, até 5MB)", accept: "image/jpeg,image/png", mimes: ["image/jpeg", "image/png"], maxBytes: 5 * 1024 * 1024 },
  DOCUMENT: { label: "documento (PDF, até 20MB)", accept: "application/pdf", mimes: ["application/pdf"], maxBytes: 20 * 1024 * 1024 },
};

export function headerMediaRule(format: HeaderMediaFormat): Rule {
  return RULES[format];
}

// Formato do cabeçalho do template -> o que a plataforma sabe mandar. VIDEO e outros viram "não suportado".
export function headerSupport(format: string | null | undefined): { kind: "none" } | { kind: "media"; format: HeaderMediaFormat } | { kind: "unsupported"; format: string } {
  if (!format || format === "TEXT") return { kind: "none" };
  if (format === "IMAGE" || format === "DOCUMENT") return { kind: "media", format };
  return { kind: "unsupported", format };
}

export function validateHeaderFile(format: HeaderMediaFormat, mimeType: string, size: number): string | null {
  const rule = RULES[format];
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  if (!size) return "Selecione um arquivo.";
  if (!rule.mimes.includes(mime)) return `Esse template pede ${rule.label}.`;
  if (size > rule.maxBytes) return `Arquivo grande demais: ${rule.label}.`;
  return null;
}

// Caminho no bucket: sempre sob <workspace>/campaign-headers/ — é esse prefixo que a criação da campanha
// confere antes de aceitar o arquivo como cabeçalho (um caminho forjado não vale pra outro workspace).
export function campaignHeaderPrefix(workspaceId: string): string {
  return `${workspaceId}/campaign-headers/`;
}

export function campaignHeaderPath(workspaceId: string, mimeType: string): string {
  const mime = mimeType.split(";")[0].trim().toLowerCase();
  const ext = mime === "image/png" ? "png" : mime === "application/pdf" ? "pdf" : "jpg";
  return `${campaignHeaderPrefix(workspaceId)}${crypto.randomUUID()}.${ext}`;
}

export function isOwnHeaderPath(workspaceId: string, path: string): boolean {
  const prefix = campaignHeaderPrefix(workspaceId);
  // Só o formato exato que campaignHeaderPath gera: <uuid>.<jpg|png|pdf>, sem subpasta nem "..".
  return path.startsWith(prefix) && /^[0-9a-f-]{36}\.(jpg|png|pdf)$/.test(path.slice(prefix.length));
}
