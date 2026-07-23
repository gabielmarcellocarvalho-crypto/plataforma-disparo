// Extração de texto de material de estudo (PDF/planilha/texto) pra virar contexto do agente.
// Nunca enviado ao cliente — só informa o modelo. Rejeita cedo (tamanho) e trunca (caracteres)
// pra nunca gastar memória/tempo à toa nem inflar o custo do prompt.
import * as XLSX from "xlsx";
import { MAX_UPLOAD_BYTES, MAX_CHARS_PER_FILE } from "@/lib/agent-knowledge-limits";

export type KnowledgeExtraction = { text: string; error?: string };

const EXTRACT_TIMEOUT_MS = 20000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

async function extract(file: File, buffer: Buffer): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return result.text;
    } finally {
      await parser.destroy();
    }
  }
  if (name.endsWith(".xlsx") || name.endsWith(".xls") || name.endsWith(".csv")) {
    const wb = XLSX.read(buffer, { type: "buffer" });
    return wb.SheetNames.map((sheetName) => `## ${sheetName}\n${XLSX.utils.sheet_to_csv(wb.Sheets[sheetName])}`).join("\n\n");
  }
  if (name.endsWith(".txt") || name.endsWith(".md")) {
    return buffer.toString("utf-8");
  }
  throw new Error("unsupported");
}

export async function extractKnowledgeText(file: File): Promise<KnowledgeExtraction> {
  if (file.size > MAX_UPLOAD_BYTES) {
    return {
      text: "",
      error: `Arquivo muito grande (${(file.size / 1024 / 1024).toFixed(1)}MB). Limite: ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB por arquivo.`,
    };
  }

  const name = file.name.toLowerCase();
  if (!/\.(pdf|xlsx|xls|csv|txt|md)$/.test(name)) {
    return { text: "", error: "Formato não suportado. Use PDF, planilha (xlsx/xls/csv) ou texto (.txt/.md)." };
  }

  let text: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    text = await withTimeout(extract(file, buffer), EXTRACT_TIMEOUT_MS);
  } catch {
    return { text: "", error: "Não consegui ler esse arquivo (formato inválido, corrompido ou demorou demais pra processar)." };
  }

  text = text.trim();
  if (!text) return { text: "", error: "Não encontrei texto nesse arquivo." };
  if (text.length > MAX_CHARS_PER_FILE) text = text.slice(0, MAX_CHARS_PER_FILE) + "\n\n[conteúdo truncado — arquivo muito grande]";

  return { text };
}
