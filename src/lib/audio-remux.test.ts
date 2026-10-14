import { describe, expect, it } from "vitest";
import { buildOggOpus, mp4OpusToOgg, oggCrc, opusPacketSamples } from "@/lib/audio-remux";

const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat();
  return [...u32(8 + body.length), ...ascii(type), ...body];
};

// MP4 fragmentado mínimo, no formato que o Chrome grava: ftyp, moov (com Opus/dOps), moof (tfhd+trun) e mdat.
function fakeChromeMp4(packets: number[][]) {
  const dops = box("dOps", [0, 1], u16(312), u32(48000), u16(0), [0]);
  const opus = box("Opus", new Array(28).fill(0), dops);
  const stsd = box("stsd", [0, 0, 0, 0], u32(1), opus);
  const moov = box("moov", box("trak", box("mdia", box("minf", box("stbl", stsd)))));
  const ftyp = box("ftyp", ascii("isom"), u32(0), ascii("isom"));

  const tfhd = box("tfhd", [0, 0x02, 0x00, 0x00], u32(1)); // flags: default-base-is-moof (0x020000)
  const sizes = packets.map((p) => u32(p.length)).flat();
  const trunLen = 8 + 4 + 4 + 4 + sizes.length;
  const tfhdLen = tfhd.length;
  const moofLen = 8 + 8 + tfhdLen + trunLen;
  const dataOffset = moofLen + 8; // até o início do corpo do mdat
  const trun = box("trun", [0, 0x00, 0x02, 0x01], u32(packets.length), u32(dataOffset), sizes);
  const moof = box("moof", box("traf", tfhd, trun));
  const mdat = box("mdat", packets.flat());
  return new Uint8Array([...ftyp, ...moov, ...moof, ...mdat]);
}

// Lê as páginas de um Ogg gerado, conferindo o CRC de cada uma.
function readOgg(data: Uint8Array) {
  const pages: { type: number; granule: number; packets: Uint8Array[]; crcOk: boolean }[] = [];
  let o = 0;
  while (o < data.length) {
    expect(String.fromCharCode(...data.slice(o, o + 4))).toBe("OggS");
    const view = new DataView(data.buffer, data.byteOffset + o);
    const n = data[o + 26];
    const lacing = [...data.slice(o + 27, o + 27 + n)];
    const bodyLen = lacing.reduce((a, b) => a + b, 0);
    const len = 27 + n + bodyLen;
    const copy = data.slice(o, o + len);
    const stored = new DataView(copy.buffer).getUint32(22, true);
    new DataView(copy.buffer).setUint32(22, 0, true);
    const packets: Uint8Array[] = [];
    let pos = o + 27 + n;
    let cur = 0;
    for (const l of lacing) {
      cur += l;
      if (l < 255) {
        packets.push(data.slice(pos, pos + cur));
        pos += cur;
        cur = 0;
      }
    }
    pages.push({ type: data[o + 5], granule: Number(view.getBigUint64(6, true)), packets, crcOk: oggCrc(copy) === stored });
    o += len;
  }
  return pages;
}

describe("opusPacketSamples", () => {
  it("lê a duração do byte TOC", () => {
    expect(opusPacketSamples(Uint8Array.of(0xf8))).toBe(960); // CELT fullband, 20 ms, 1 quadro
    expect(opusPacketSamples(Uint8Array.of(0xfb, 3))).toBe(2880); // 20 ms, 3 quadros (código 3)
    expect(opusPacketSamples(Uint8Array.of(0x78))).toBe(960); // híbrido, config 15 = 20 ms, 1 quadro
    expect(opusPacketSamples(Uint8Array.of(0x08))).toBe(960); // SILK, config 1 = 20 ms, 1 quadro
  });
});

describe("mp4OpusToOgg", () => {
  const packets = [
    [0xf8, 1, 2, 3, 4],
    [0xf8, 5, 6, 7],
    [0xf8, 8, 9],
  ];

  it("troca o envelope MP4 por Ogg/Opus sem mexer nos pacotes", () => {
    const ogg = mp4OpusToOgg(fakeChromeMp4(packets));
    expect(ogg).not.toBeNull();
    const pages = readOgg(ogg!);
    expect(pages.every((p) => p.crcOk)).toBe(true);
    expect(pages[0].type).toBe(0x02); // início do stream
    expect(String.fromCharCode(...pages[0].packets[0].slice(0, 8))).toBe("OpusHead");
    expect(String.fromCharCode(...pages[1].packets[0].slice(0, 8))).toBe("OpusTags");
    const audio = pages.slice(2);
    expect(audio[audio.length - 1].type).toBe(0x04); // fim do stream
    expect(audio.flatMap((p) => p.packets.map((x) => [...x]))).toEqual(packets);
    expect(audio[audio.length - 1].granule).toBe(3 * 960);
  });

  it("guarda o pre-skip e os canais no cabeçalho", () => {
    const pages = readOgg(mp4OpusToOgg(fakeChromeMp4(packets))!);
    const head = pages[0].packets[0];
    expect(head[9]).toBe(1);
    expect(new DataView(head.buffer, head.byteOffset).getUint16(10, true)).toBe(312);
  });

  it("devolve null para o que não é Opus em MP4", () => {
    expect(mp4OpusToOgg(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
    expect(mp4OpusToOgg(new Uint8Array(0))).toBeNull();
  });

  it("pacote de 255 bytes ganha o segmento final de tamanho zero", () => {
    const big = new Uint8Array(255).fill(7);
    big[0] = 0xf8;
    const pages = readOgg(buildOggOpus({ channels: 1, preSkip: 312, inputRate: 48000, gain: 0 }, [big]));
    expect(pages[2].packets[0].length).toBe(255);
  });
});
