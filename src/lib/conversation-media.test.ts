import { describe, expect, it } from "vitest";
import { CONVERSATION_MEDIA_MIMES, resolveFileMime } from "@/lib/conversation-media";

describe("resolveFileMime", () => {
  it("planilha xlsx com tipo correto passa", () => {
    const m = resolveFileMime("vendas.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(CONVERSATION_MEDIA_MIMES.has(m)).toBe(true);
  });
  it("sem tipo ou octet-stream, usa a extensão", () => {
    expect(resolveFileMime("lista.xlsx", "")).toContain("spreadsheetml");
    expect(resolveFileMime("lista.xls", "application/octet-stream")).toBe("application/vnd.ms-excel");
  });
  it("csv vira text/csv mesmo que o Windows diga vnd.ms-excel", () => {
    expect(resolveFileMime("contatos.csv", "application/vnd.ms-excel")).toBe("text/csv");
    expect(resolveFileMime("contatos.CSV", "")).toBe("text/csv");
  });
  it("tira o parâmetro do tipo (áudio gravado)", () => {
    expect(resolveFileMime("audio.webm", "audio/webm;codecs=opus")).toBe("audio/webm");
  });
  it("executável continua recusado", () => {
    expect(CONVERSATION_MEDIA_MIMES.has(resolveFileMime("virus.exe", "application/x-msdownload"))).toBe(false);
    expect(CONVERSATION_MEDIA_MIMES.has(resolveFileMime("a.exe", ""))).toBe(false);
  });
});
