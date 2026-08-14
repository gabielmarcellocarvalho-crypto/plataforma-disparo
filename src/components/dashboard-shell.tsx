"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import type { AccessType } from "@/lib/access-types";

// Dono do estado de "menu aberto/fechado" — precisa ser um client component porque tanto o botão
// hambúrguer (topo mobile) quanto a sidebar (drawer que desliza) reagem ao mesmo estado. O layout
// (Server Component) só monta esse shell e repassa os slots (workspace/usuário) já resolvidos.
export function DashboardShell({
  workspaceSlot,
  userSlot,
  isColaborador,
  accessType,
  attentionCount,
  children,
}: {
  workspaceSlot: React.ReactNode;
  userSlot: React.ReactNode;
  isColaborador: boolean;
  accessType: AccessType | null;
  attentionCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Navegar pra outra tela fecha o menu sozinho — sem isso, no celular o drawer ficaria
  // aberto por cima da tela nova depois de tocar num link.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex min-h-screen">
      <Sidebar
        workspaceSlot={workspaceSlot}
        userSlot={userSlot}
        isColaborador={isColaborador}
        accessType={accessType}
        attentionCount={attentionCount}
        open={open}
      />

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/40 z-30 lg:hidden cursor-default"
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 lg:ml-[250px]">
        <header className="lg:hidden flex items-center gap-3 border-b border-border bg-surface px-4 py-3 sticky top-0 z-20 shrink-0">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setOpen(true)}
            className="grid place-items-center w-9 h-9 rounded-md border border-border text-text cursor-pointer shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-extrabold text-sm">AutomaX</span>
        </header>

        <main className="flex-1 min-w-0 p-4 sm:p-7 max-w-[1280px] w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}
