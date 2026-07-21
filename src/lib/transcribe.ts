// Transcrição de áudio recebido no WhatsApp (mensagens de voz) via Whisper da OpenAI,
// pra que o agente "ouça" o que o contato mandou. Sem OPENAI_API_KEY, a transcrição fica
// indisponível e o áudio vira handoff pra humano (o agente não inventa o que não ouviu).
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

function extensionFor(mimetype: string) {
  if (mimetype.includes("ogg")) return "ogg";
  if (mimetype.includes("mp4") || mimetype.includes("m4a")) return "mp4";
  if (mimetype.includes("mpeg") || mimetype.includes("mp3")) return "mp3";
  if (mimetype.includes("wav")) return "wav";
  return "ogg";
}

export function transcriptionAvailable() {
  return Boolean(OPENAI_API_KEY);
}

export async function transcribeAudio(base64: string, mimetype: string): Promise<string | null> {
  if (!OPENAI_API_KEY) return null;

  const buffer = Buffer.from(base64, "base64");
  const file = new Blob([buffer], { type: mimetype });

  const form = new FormData();
  form.append("file", file, `audio.${extensionFor(mimetype)}`);
  form.append("model", "whisper-1");
  form.append("language", "pt");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });

  if (!res.ok) {
    console.error(`Whisper ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }

  const json = (await res.json()) as { text?: string };
  return (json.text || "").trim() || null;
}
