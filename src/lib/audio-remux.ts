// Reempacota áudio Opus de um MP4 fragmentado (o que o Chrome grava em "audio/mp4") num arquivo Ogg/Opus.
//
// Por quê: o WhatsApp só aceita áudio MP4 com AAC; Opus só vale dentro de Ogg. O Chrome grava Opus dentro
// de MP4, então a Meta aceitava o link, respondia "ok" e depois não conseguia processar o arquivo — o
// áudio nunca chegava no contato, sem erro nenhum na tela. Como o codec já é Opus, basta trocar o
// "envelope" (sem recodificar, sem perda). Ogg/Opus ainda aparece no WhatsApp como mensagem de voz.
//
// Devolve null quando o arquivo não é Opus em MP4 (ex.: AAC do Safari, que a Meta já aceita).

type Box = { type: string; start: number; end: number; body: number };

function readBoxes(buf: Uint8Array, from: number, to: number): Box[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const boxes: Box[] = [];
  let o = from;
  while (o + 8 <= to) {
    let size = view.getUint32(o);
    const type = String.fromCharCode(buf[o + 4], buf[o + 5], buf[o + 6], buf[o + 7]);
    let body = o + 8;
    if (size === 1) {
      if (o + 16 > to) break;
      size = Number(view.getBigUint64(o + 8));
      body = o + 16;
    } else if (size === 0) {
      size = to - o;
    }
    if (size < body - o || o + size > to) break;
    boxes.push({ type, start: o, end: o + size, body });
    o += size;
  }
  return boxes;
}

function child(buf: Uint8Array, parent: Box, type: string): Box | undefined {
  return readBoxes(buf, parent.body, parent.end).find((b) => b.type === type);
}

type OpusConfig = { channels: number; preSkip: number; inputRate: number; gain: number };

// Caixa dOps (dentro da entrada "Opus" do stsd): versão, canais, pre-skip, taxa original, ganho, mapeamento.
function readOpusConfig(buf: Uint8Array, moov: Box): OpusConfig | null {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (const trak of readBoxes(buf, moov.body, moov.end).filter((b) => b.type === "trak")) {
    const mdia = child(buf, trak, "mdia");
    const minf = mdia && child(buf, mdia, "minf");
    const stbl = minf && child(buf, minf, "stbl");
    const stsd = stbl && child(buf, stbl, "stsd");
    if (!stsd) continue;
    // stsd: 4 bytes versão/flags + 4 bytes de contagem, depois as entradas.
    for (const entry of readBoxes(buf, stsd.body + 8, stsd.end)) {
      if (entry.type !== "Opus") continue;
      // AudioSampleEntry: 6 reservados + 2 índice + 8 reservados + 2 canais + 2 bits + 4 + 4 taxa = 28 bytes.
      const dops = readBoxes(buf, entry.body + 28, entry.end).find((b) => b.type === "dOps");
      if (!dops || dops.end - dops.body < 11) return null;
      const b = dops.body;
      return { channels: buf[b + 1], preSkip: view.getUint16(b + 2), inputRate: view.getUint32(b + 4), gain: view.getInt16(b + 8) };
    }
  }
  return null;
}

// Pacotes de áudio de cada fragmento (moof + mdat). O Chrome grava sempre assim.
function readPackets(buf: Uint8Array): Uint8Array[] {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const packets: Uint8Array[] = [];
  for (const moof of readBoxes(buf, 0, buf.length).filter((b) => b.type === "moof")) {
    for (const traf of readBoxes(buf, moof.body, moof.end).filter((b) => b.type === "traf")) {
      const tfhd = child(buf, traf, "tfhd");
      const trun = child(buf, traf, "trun");
      if (!tfhd || !trun) continue;

      const tfFlags = view.getUint32(tfhd.body) & 0xffffff;
      let p = tfhd.body + 8; // versão/flags + track_id
      let baseOffset = moof.start; // padrão: relativo ao início do moof
      if (tfFlags & 0x01) {
        baseOffset = Number(view.getBigUint64(p));
        p += 8;
      }
      if (tfFlags & 0x02) p += 4;
      if (tfFlags & 0x08) p += 4; // duração padrão (o tamanho vem do trun ou do padrão abaixo)
      let defaultSize = 0;
      if (tfFlags & 0x10) {
        defaultSize = view.getUint32(p);
        p += 4;
      }

      const trFlags = view.getUint32(trun.body) & 0xffffff;
      const count = view.getUint32(trun.body + 4);
      let q = trun.body + 8;
      let dataOffset = 0;
      if (trFlags & 0x01) {
        dataOffset = view.getInt32(q);
        q += 4;
      }
      if (trFlags & 0x04) q += 4;
      let pos = baseOffset + dataOffset;
      for (let i = 0; i < count; i++) {
        if (trFlags & 0x100) q += 4;
        let size = defaultSize;
        if (trFlags & 0x200) {
          size = view.getUint32(q);
          q += 4;
        }
        if (trFlags & 0x400) q += 4;
        if (trFlags & 0x800) q += 4;
        if (size <= 0 || pos + size > buf.length) return [];
        packets.push(buf.subarray(pos, pos + size));
        pos += size;
      }
    }
  }
  return packets;
}

// Duração do pacote Opus em amostras de 48 kHz, lida do byte TOC (RFC 6716, seção 3.1).
export function opusPacketSamples(packet: Uint8Array): number {
  if (packet.length === 0) return 0;
  const toc = packet[0];
  const config = toc >> 3;
  let frameMs: number;
  if (config < 12) frameMs = [10, 20, 40, 60][config % 4];
  else if (config < 16) frameMs = config % 2 === 0 ? 10 : 20;
  else frameMs = [2.5, 5, 10, 20][config % 4];
  const code = toc & 3;
  const frames = code === 0 ? 1 : code === 3 ? (packet[1] ?? 1) & 0x3f : 2;
  return Math.round(frameMs * 48 * frames);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    t[i] = r >>> 0;
  }
  return t;
})();

export function oggCrc(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ data[i]) & 0xff]) >>> 0;
  return crc >>> 0;
}

function oggPage(serial: number, seq: number, headerType: number, granule: number, packets: Uint8Array[]): Uint8Array {
  const lacing: number[] = [];
  for (const pk of packets) {
    let n = pk.length;
    while (n >= 255) {
      lacing.push(255);
      n -= 255;
    }
    lacing.push(n);
  }
  const bodyLen = packets.reduce((s, pk) => s + pk.length, 0);
  const page = new Uint8Array(27 + lacing.length + bodyLen);
  const v = new DataView(page.buffer);
  page.set([0x4f, 0x67, 0x67, 0x53], 0); // "OggS"
  page[5] = headerType;
  v.setUint32(6, granule % 0x100000000, true);
  v.setUint32(10, Math.floor(granule / 0x100000000), true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  page[26] = lacing.length;
  page.set(lacing, 27);
  let o = 27 + lacing.length;
  for (const pk of packets) {
    page.set(pk, o);
    o += pk.length;
  }
  v.setUint32(22, oggCrc(page), true);
  return page;
}

const text = (s: string) => new TextEncoder().encode(s);

// Monta o Ogg/Opus a partir da configuração e dos pacotes já extraídos.
export function buildOggOpus(cfg: OpusConfig, packets: Uint8Array[], serial = 0x41757461): Uint8Array {
  const head = new Uint8Array(19);
  head.set(text("OpusHead"), 0);
  head[8] = 1;
  head[9] = cfg.channels;
  const hv = new DataView(head.buffer);
  hv.setUint16(10, cfg.preSkip, true);
  hv.setUint32(12, cfg.inputRate, true);
  hv.setInt16(16, cfg.gain, true);
  head[18] = 0;

  const vendor = text("automax");
  const tags = new Uint8Array(8 + 4 + vendor.length + 4);
  tags.set(text("OpusTags"), 0);
  const tv = new DataView(tags.buffer);
  tv.setUint32(8, vendor.length, true);
  tags.set(vendor, 12);
  tv.setUint32(12 + vendor.length, 0, true);

  const pages: Uint8Array[] = [oggPage(serial, 0, 0x02, 0, [head]), oggPage(serial, 1, 0x00, 0, [tags])];
  let seq = 2;
  let granule = 0;
  const PER_PAGE = 25; // ~0,5 s de áudio por página; cada página leva no máximo 255 segmentos
  for (let i = 0; i < packets.length; i += PER_PAGE) {
    const chunk = packets.slice(i, i + PER_PAGE);
    for (const pk of chunk) granule += opusPacketSamples(pk);
    const last = i + PER_PAGE >= packets.length;
    pages.push(oggPage(serial, seq++, last ? 0x04 : 0x00, granule, chunk));
  }

  const out = new Uint8Array(pages.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of pages) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function mp4OpusToOgg(input: Uint8Array): Uint8Array | null {
  try {
    const moov = readBoxes(input, 0, input.length).find((b) => b.type === "moov");
    if (!moov) return null;
    const cfg = readOpusConfig(input, moov);
    if (!cfg) return null;
    const packets = readPackets(input);
    if (packets.length === 0) return null;
    return buildOggOpus(cfg, packets);
  } catch {
    return null;
  }
}
