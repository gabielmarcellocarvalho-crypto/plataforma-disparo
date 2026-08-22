import { PNG } from "pngjs";
import jpeg from "jpeg-js";

// Extrai a cor dominante "de marca" de uma logo — não é uma média simples do bitmap (isso ia dar um
// cinza/branco lavado, já que a maioria das logos tem bastante fundo branco/transparente). Em vez
// disso: ignora pixels quase-brancos, quase-pretos e transparentes, agrupa o resto em baldes de cor
// e escolhe o balde mais frequente.
//
// Decodificação 100% JS (pngjs/jpeg-js, sem binário nativo) de propósito — um extrator "bonzinho" que
// depende de biblioteca nativa (ex.: sharp) quebra em produção sempre que o runtime serverless não
// carrega o binário certo (já aconteceu aqui: ERR_DLOPEN_FAILED faltando libvips na Vercel). Preferir
// a solução mais simples e portátil, mesmo que decodifique menos formatos, evita essa classe de erro.
function decodeRawRgba(buffer: Buffer, mimetype: string): { data: Buffer | Uint8Array; width: number; height: number } | null {
  if (mimetype === "image/png") {
    const png = PNG.sync.read(buffer);
    return { data: png.data, width: png.width, height: png.height };
  }
  if (mimetype === "image/jpeg") {
    const img = jpeg.decode(buffer, { useTArray: true });
    return { data: img.data, width: img.width, height: img.height };
  }
  return null; // webp/svg — sem decodificador puro-JS disponível, cor de marca não é recalculada
}

export async function extractDominantColor(buffer: Buffer, mimetype: string): Promise<string | null> {
  try {
    const decoded = decodeRawRgba(buffer, mimetype);
    if (!decoded) return null;

    const { data } = decoded;
    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a < 128) continue; // transparente

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const lightness = (max + min) / 2;
      const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(2 * lightness - 255));
      if (lightness > 235 || lightness < 20) continue; // quase branco / quase preto — não é "a cor"
      if (saturation < 0.15) continue; // cinza puro — não carrega identidade de marca

      // Quantiza em baldes de 24 níveis por canal pra juntar tons próximos.
      const key = `${Math.round(r / 24)}-${Math.round(g / 24)}-${Math.round(b / 24)}`;
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
      } else {
        buckets.set(key, { count: 1, r, g, b });
      }
    }

    if (buckets.size === 0) return null;

    const [best] = [...buckets.values()].sort((a, b) => b.count - a.count);
    const r = Math.round(best.r / best.count);
    const g = Math.round(best.g / best.count);
    const b = Math.round(best.b / best.count);
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  } catch (err) {
    console.error("Erro ao extrair cor da logo:", (err as Error).message);
    return null;
  }
}
