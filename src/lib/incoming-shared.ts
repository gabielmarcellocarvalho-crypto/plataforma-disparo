// Localização e contato compartilhado viram texto pro agente (que só lê texto/imagem/áudio): o lead
// manda o pin ou o cartão de contato como resposta e a conversa segue, em vez de cair em "arquivo não suportado".

export function formatSharedLocation(loc: { latitude?: number | null; longitude?: number | null; name?: string | null; address?: string | null }): string | null {
  const { latitude, longitude } = loc;
  const hasCoords = typeof latitude === "number" && typeof longitude === "number";
  const place = [loc.name, loc.address].map((s) => (s || "").trim()).filter(Boolean).join(" — ");
  if (!hasCoords && !place) return null;
  const coords = hasCoords ? ` (lat ${latitude}, long ${longitude})` : "";
  return `[O cliente compartilhou uma localização: ${place || "sem nome"}${coords}]`;
}

export function formatSharedContacts(contacts: Array<{ name?: string | null; phones?: Array<string | null | undefined> }>): string | null {
  const parts = contacts
    .map((c) => {
      const name = (c.name || "").trim();
      const phones = (c.phones || []).map((p) => (p || "").trim()).filter(Boolean);
      if (!name && phones.length === 0) return null;
      return `${name || "sem nome"}${phones.length ? ` — ${phones.join(", ")}` : ""}`;
    })
    .filter((p): p is string => Boolean(p));
  if (parts.length === 0) return null;
  return `[O cliente compartilhou ${parts.length === 1 ? "um contato" : `${parts.length} contatos`}: ${parts.join("; ")}]`;
}

// Telefones de um vCard (linhas "TEL...:+55 11 99999-9999", com ou sem "waid=").
export function phonesFromVcard(vcard: string | null | undefined): string[] {
  if (!vcard) return [];
  const out: string[] = [];
  for (const line of vcard.split(/\r?\n/)) {
    if (!/^TEL/i.test(line)) continue;
    const value = line.slice(line.lastIndexOf(":") + 1).trim();
    if (value) out.push(value);
  }
  return out;
}
