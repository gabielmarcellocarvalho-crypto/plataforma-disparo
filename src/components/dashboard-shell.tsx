"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Sidebar, SIDEBAR_WIDTH, SIDEBAR_WIDTH_COLLAPSED } from "@/components/sidebar";
import type { AccessType } from "@/lib/access-types";

const CHAVE_RECOLHIDO = "sidebar:collapsed";

// A preferência de menu recolhido é conveniência de quem está olhando, não dado do workspace: mora
// no navegador. Ela é uma fonte EXTERNA ao React, então é lida por useSyncExternalStore em vez de
// useEffect+setState — com efeito, o primeiro render sairia expandido e piscaria pro recolhido.
// localStorage pode simplesmente não existir (janela anônima, site data bloqueado), daí o try/catch
// em toda leitura e escrita; sem ele, a tela inteira quebraria por causa de uma preferência de menu.
const ouvintes = new Set<() => void>();

function lerRecolhido(): boolean {
  try {
    return localStorage.getItem(CHAVE_RECOLHIDO) === "1";
  } catch {
    return false;
  }
}

function assinarRecolhido(aoMudar: () => void) {
  ouvintes.add(aoMudar);
  // Outra aba do mesmo usuário mudando a preferência também atualiza esta.
  window.addEventListener("storage", aoMudar);
  return () => {
    ouvintes.delete(aoMudar);
    window.removeEventListener("storage", aoMudar);
  };
}

function gravarRecolhido(valor: boolean) {
  try {
    localStorage.setItem(CHAVE_RECOLHIDO, valor ? "1" : "0");
  } catch {
    // sem storage: a preferência não sobrevive ao reload, mas a tela continua funcionando
  }
  for (const ouvinte of ouvintes) ouvinte();
}

// Dono do estado de "menu aberto/fechado" e "recolhido/expandido" — precisa ser um client component
// porque o botão hambúrguer (topo mobile), a sidebar e o deslocamento do conteúdo reagem ao mesmo
// estado. O layout (Server Component) só monta esse shell e repassa os slots já resolvidos.
export function DashboardShell({
  workspaceSlot,
  workspaceCompact,
  userSlot,
  userCompact,
  isStaff,
  isDeveloper,
  accessType,
  hiddenPages,
  attentionCount,
  children,
}: {
  workspaceSlot: React.ReactNode;
  workspaceCompact: React.ReactNode;
  userSlot: React.ReactNode;
  userCompact: React.ReactNode;
  isStaff: boolean;
  isDeveloper: boolean;
  accessType: AccessType | null;
  hiddenPages: string[];
  attentionCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // O 3º argumento é o snapshot do servidor: no HTML renderizado não existe localStorage, então ele
  // sai sempre expandido e o cliente reconcilia com a preferência real na hidratação.
  const collapsed = useSyncExternalStore(assinarRecolhido, lerRecolhido, () => false);

  // Navegar pra outra tela fecha o menu sozinho — sem isso, no celular o drawer ficaria
  // aberto por cima da tela nova depois de tocar num link.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Atalho pra quem navega por teclado pular os ~13 links do menu e cair no conteúdo. Fica
          invisível até receber foco. */}
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md
          focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-bold focus:shadow-md"
      >
        Pular para o conteúdo
      </a>

      <Sidebar
        workspaceSlot={workspaceSlot}
        workspaceCompact={workspaceCompact}
        userSlot={userSlot}
        userCompact={userCompact}
        isStaff={isStaff}
        isDeveloper={isDeveloper}
        accessType={accessType}
        hiddenPages={hiddenPages}
        attentionCount={attentionCount}
        open={open}
        collapsed={collapsed}
        onToggleCollapse={() => gravarRecolhido(!collapsed)}
      />

      {open && (
        <button
          type="button"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
          className="fixed inset-0 bg-black/40 z-30 lg:hidden cursor-default"
        />
      )}

      {/* min-h-0 é o que permite essa coluna encolher dentro do h-screen do pai em vez de estourar a
          altura — sem isso o <main> abaixo não consegue virar a área de rolagem (fica do tamanho do
          conteúdo, empurrando a página inteira).
          A margem esquerda acompanha a largura da sidebar e só existe a partir de lg, onde ela é
          fixa; abaixo disso a sidebar é drawer e flutua por cima. A largura vem por variável CSS
          (não por classe) porque é um número dinâmico — Tailwind só gera as classes que existem no
          código, então `ml-[236px]`/`ml-[68px]` alternados não sairiam no CSS final. */}
      <div
        className="flex-1 flex flex-col min-w-0 min-h-0 lg:ml-[var(--sidebar-w)] transition-[margin] duration-200 ease-out motion-reduce:transition-none"
        style={{ ["--sidebar-w" as string]: `${collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH}px` }}
      >
        <header className="lg:hidden flex items-center gap-3 border-b border-border bg-surface px-4 py-3 shrink-0">
          <button
            type="button"
            aria-label="Abrir menu"
            onClick={() => setOpen(true)}
            className="grid place-items-center w-11 h-11 rounded-md border border-border text-text cursor-pointer shrink-0"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <span className="font-extrabold text-sm">AutomaX</span>
        </header>

        <main id="conteudo" className="flex-1 min-h-0 min-w-0 overflow-y-auto p-4 lg:p-5">
          {children}
        </main>
      </div>
    </div>
  );
}
