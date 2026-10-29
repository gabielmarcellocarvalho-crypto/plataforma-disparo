import { describe, expect, it } from "vitest";
import { headerImageMarker, lastHeaderImageUrl, stripHeaderImageMarker } from "@/lib/agent-opening-media";

const URL1 = "https://x.supabase.co/storage/v1/object/public/conversation-media/a/campaign-headers/1.jpg";
const URL2 = "https://x.supabase.co/storage/v1/object/public/conversation-media/a/campaign-headers/2.jpg";

describe("imagem do cabeçalho na conversa", () => {
  it("acha o link mais recente", () => {
    const msgs = [`[Template: a]\noi\n${headerImageMarker(URL1)}`, "tudo bem", `[Template: b]\n${headerImageMarker(URL2)}`];
    expect(lastHeaderImageUrl(msgs)).toBe(URL2);
  });

  it("sem marcador não devolve nada", () => {
    expect(lastHeaderImageUrl(["oi", "[Template: a]\ntexto"])).toBeNull();
  });

  it("tira o link do texto que vai pro modelo", () => {
    const out = stripHeaderImageMarker(`[Template: a]\noi\n${headerImageMarker(URL1)}`);
    expect(out).not.toContain("https://");
    expect(out).toContain("imagem anexada");
    expect(out).toContain("oi");
  });
});
