import { describe, expect, it } from "vitest";
import { parseCoexistenceMessages } from "@/lib/smb-coexistence";

const wrap = (field: string, value: unknown) => ({ object: "whatsapp_business_account", entry: [{ id: "w1", changes: [{ field, value }] }] });
const meta = { display_phone_number: "15550783881", phone_number_id: "106540352242922" };

describe("parseCoexistenceMessages", () => {
  it("lê a mensagem enviada pelo celular (echo)", () => {
    const out = parseCoexistenceMessages(
      wrap("smb_message_echoes", {
        metadata: meta,
        message_echoes: [{ from: "15550783881", to: "16505551234", id: "wamid.A", timestamp: "1739321024", type: "text", text: { body: "Oi, tudo bem?" } }],
      })
    );
    expect(out).toEqual([
      { phoneNumberId: "106540352242922", customerPhone: "16505551234", fromBusiness: true, externalId: "wamid.A", createdAt: "2025-02-12T00:43:44.000Z", content: "Oi, tudo bem?", kind: "echo" },
    ]);
  });

  it("mídia vira marcador e apagar/editar é ignorado", () => {
    const out = parseCoexistenceMessages(
      wrap("smb_message_echoes", {
        metadata: meta,
        message_echoes: [
          { to: "16505551234", id: "wamid.B", timestamp: "1", type: "image", image: { caption: "catálogo" } },
          { to: "16505551234", id: "wamid.C", timestamp: "1", type: "revoke" },
        ],
      })
    );
    expect(out.map((m) => m.content)).toEqual(["[imagem] catálogo"]);
  });

  it("no histórico, separa o que o cliente mandou do que o negócio mandou", () => {
    const out = parseCoexistenceMessages(
      wrap("history", {
        metadata: meta,
        history: [
          {
            metadata: { phase: 1, chunk_order: 1, progress: 55 },
            threads: [
              {
                id: "16505551234",
                messages: [
                  { from: "15550783881", id: "wamid.H1", timestamp: "1739230955", type: "text", text: { body: "Segue a info" } },
                  { from: "16505551234", id: "wamid.H2", timestamp: "1739230970", type: "text", text: { body: "Obrigado!" } },
                  { from: "16505551234", id: "wamid.H3", timestamp: "1739230971", type: "media_placeholder" },
                ],
              },
            ],
          },
        ],
      })
    );
    expect(out.map((m) => [m.externalId, m.fromBusiness, m.content, m.kind])).toEqual([
      ["wamid.H1", true, "Segue a info", "history"],
      ["wamid.H2", false, "Obrigado!", "history"],
      ["wamid.H3", false, "[mídia]", "history"],
    ]);
  });

  it("ignora payload de outros eventos e histórico recusado", () => {
    expect(parseCoexistenceMessages(wrap("messages", { metadata: meta, messages: [{ from: "1", id: "x", type: "text", text: { body: "oi" } }] }))).toEqual([]);
    expect(parseCoexistenceMessages(wrap("history", { metadata: meta, history: [{ errors: [{ code: 2593109 }] }] }))).toEqual([]);
    expect(parseCoexistenceMessages(null)).toEqual([]);
  });
});
