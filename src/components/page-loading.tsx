// Skeleton simples mostrado pelo loading.tsx do Next.js enquanto a página busca dados novos (ex.:
// troca de período no filtro) — só a área de conteúdo pisca, sidebar/topo continuam parados.
export function PageLoading() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh]">
      <span className="w-9 h-9 rounded-full border-[3px] border-border border-t-primary-strong animate-spin" aria-hidden />
      <p className="text-sm text-text-muted font-semibold">Carregando…</p>
    </div>
  );
}
