// Respostas rápidas do composer de Conversas (digitar "/" abre a lista). Ficam no navegador de quem usa,
// por workspace — não há tabela pra isso ainda; quando houver, só este módulo muda.
export type QuickReply = { id: string; shortcut: string; text: string };

const key = (workspaceId: string) => `quick-replies:${workspaceId}`;

export function loadQuickReplies(workspaceId: string): QuickReply[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(workspaceId)) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.text === "string" && typeof r.shortcut === "string") : [];
  } catch {
    return [];
  }
}

export function saveQuickReplies(workspaceId: string, replies: QuickReply[]) {
  try {
    localStorage.setItem(key(workspaceId), JSON.stringify(replies));
  } catch {
    // sem storage (janela anônima, bloqueado): vale só nesta sessão
  }
}

// Atalho a partir do texto: "/preco" etc. Só letras/números, sem acento, minúsculo.
export function normalizeShortcut(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 24);
}

// Composer começando com "/xxx" (sem espaço) = buscando resposta rápida. Devolve o termo, ou null.
export function quickReplyQuery(draft: string): string | null {
  const m = /^\/([^\s/]*)$/.exec(draft);
  return m ? normalizeShortcut(m[1]) : null;
}

export function matchQuickReplies(replies: QuickReply[], query: string): QuickReply[] {
  if (!query) return replies;
  return replies.filter((r) => r.shortcut.includes(query) || normalizeShortcut(r.text).includes(query));
}
