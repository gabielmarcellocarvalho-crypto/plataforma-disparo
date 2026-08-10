import Link from "next/link";

export function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-bold text-text">{titulo}</h2>
      <div className="flex flex-col gap-3 text-sm leading-relaxed text-text-muted">{children}</div>
    </section>
  );
}

export function LegalPage({
  titulo,
  atualizadoEm,
  children,
}: {
  titulo: string;
  atualizadoEm: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-full bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="max-w-3xl mx-auto px-6 py-5 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-automax-vermelha.png" alt="AutomaX" className="h-12 w-auto" />
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-6 py-12 flex flex-col gap-10">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-text">{titulo}</h1>
          <p className="text-sm text-text-muted">Última atualização: {atualizadoEm}</p>
        </div>

        {children}

        <div className="pt-4 border-t border-border">
          <Link href="/login" className="text-sm font-semibold text-primary-strong hover:underline">
            Voltar para o login
          </Link>
        </div>
      </article>
    </main>
  );
}
