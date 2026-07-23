// Constantes puras (sem libs pesadas) — importável tanto no client (validação rápida antes de
// subir) quanto no server (extração e limite agregado). Não colocar import de pdf-parse/xlsx aqui.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB por arquivo — acima disso nem tenta processar
export const MAX_CHARS_PER_FILE = 20000; // ~5k tokens — impacto de custo desprezível mesmo num cache miss
export const MAX_TOTAL_CHARS = 40000; // soma de todos os arquivos de estudo por agente
