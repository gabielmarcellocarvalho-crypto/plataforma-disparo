import sharp from "sharp";

// Extrai a cor dominante "de marca" de uma logo — não é uma média simples do bitmap (isso ia dar um
// cinza/branco lavado, já que a maioria das logos tem bastante fundo branco/transparente). Em vez
// disso: reduz a imagem, ignora pixels quase-brancos, quase-pretos e transparentes, agrupa o resto
// em baldes de cor e escolhe o balde mais frequente entre os mais saturados.
export async function extractDominantColor(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .resize(64, 64, { fit: "inside" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

    for (let i = 0; i < data.length; i += info.channels) {
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
