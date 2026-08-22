// Um único lugar pra saber "isso é API oficial (Cloud API da Meta) ou não" — 360dialog (BSP,
// intermediário) e metacloud (Tech Provider direto) se comportam igual em quase tudo que não é a
// própria chamada HTTP de envio/template/webhook (que cada um tem seu client: dialog360.ts / metacloud.ts).
export type WhatsappChannel = "evolution" | "360dialog" | "metacloud";

export function isOfficialWhatsappChannel(channel: string): boolean {
  return channel === "360dialog" || channel === "metacloud";
}
