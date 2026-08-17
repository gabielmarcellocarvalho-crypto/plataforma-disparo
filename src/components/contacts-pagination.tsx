"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { PAGE_SIZES } from "@/lib/contacts-pagination";

function ChevronLeft() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// Seletor de "quantos por página" — fica em cima da tabela de Contatos.
export function PageSizeSelect({ size }: { size: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(newSize: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("size", newSize);
    params.set("page", "1"); // muda o tamanho da página, volta pra primeira
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <label className="flex items-center gap-2 text-xs font-semibold text-text-muted">
      Mostrar
      <select
        value={size}
        onChange={(e) => handleChange(e.target.value)}
        className="border border-border rounded-md px-2 py-1.5 text-sm outline-none focus:border-primary"
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      por página
    </label>
  );
}

// Setas de navegação (anterior/próxima) — fica embaixo da tabela.
export function ContactsPageNav({ page, totalPages }: { page: number; totalPages: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function goTo(newPage: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(newPage));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-4">
      <button
        type="button"
        onClick={() => goTo(page - 1)}
        disabled={page <= 1}
        aria-label="Página anterior"
        className="grid place-items-center w-8 h-8 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronLeft />
      </button>
      <span className="text-xs font-semibold text-text-muted">
        Página {page} de {totalPages}
      </span>
      <button
        type="button"
        onClick={() => goTo(page + 1)}
        disabled={page >= totalPages}
        aria-label="Próxima página"
        className="grid place-items-center w-8 h-8 rounded-md border border-border text-text-muted hover:text-text hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
      >
        <ChevronRight />
      </button>
    </div>
  );
}
