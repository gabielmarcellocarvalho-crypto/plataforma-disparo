"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { canAccessPage, type AccessType } from "@/lib/access-types";

const NAV_ITEMS = [
  {
    href: "/",
    label: "Visão geral",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/conversas",
    label: "Conversas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    href: "/crm",
    label: "Pipeline",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="4" height="16" rx="1" />
        <rect x="10" y="4" width="4" height="10" rx="1" />
        <rect x="17" y="4" width="4" height="13" rx="1" />
      </svg>
    ),
  },
  {
    href: "/agenda",
    label: "Tarefas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    href: "/automacoes",
    label: "Automações",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    ),
  },
  {
    href: "/integracoes",
    label: "Integrações",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 2v6" />
        <path d="M15 2v6" />
        <path d="M6 8h12v4a6 6 0 0 1-12 0V8Z" />
        <path d="M12 18v4" />
      </svg>
    ),
  },
  {
    href: "/agentes",
    label: "Agentes de IA",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="11" width="18" height="10" rx="2" />
        <circle cx="12" cy="5" r="2" />
        <path d="M12 7v4" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
      </svg>
    ),
  },
  {
    href: "/contatos",
    label: "Contatos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: "/contatos?view=empresas",
    label: "Empresas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <path d="M9 22v-4h6v4" />
        <line x1="8" y1="6" x2="8" y2="6" />
        <line x1="12" y1="6" x2="12" y2="6" />
        <line x1="16" y1="6" x2="16" y2="6" />
        <line x1="8" y1="10" x2="8" y2="10" />
        <line x1="12" y1="10" x2="12" y2="10" />
        <line x1="16" y1="10" x2="16" y2="10" />
        <line x1="8" y1="14" x2="8" y2="14" />
        <line x1="12" y1="14" x2="12" y2="14" />
        <line x1="16" y1="14" x2="16" y2="14" />
      </svg>
    ),
  },
  {
    href: "/equipe",
    label: "Equipe",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21V8l6-4 6 4v13" />
        <path d="M15 21V11l6 4v6" />
        <line x1="3" y1="21" x2="21" y2="21" />
        <line x1="7" y1="10" x2="7" y2="10" />
        <line x1="11" y1="10" x2="11" y2="10" />
        <line x1="7" y1="14" x2="7" y2="14" />
        <line x1="11" y1="14" x2="11" y2="14" />
      </svg>
    ),
  },
  {
    href: "/templates",
    label: "Templates",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    href: "/campanhas",
    label: "Campanhas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <line x1="22" y1="2" x2="11" y2="13" />
        <polygon points="22 2 15 22 11 13 2 9 22 2" />
      </svg>
    ),
  },
  {
    href: "/metricas",
    label: "Métricas",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
      </svg>
    ),
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

const COLABORADOR_NAV_ITEMS = [
  {
    href: "/calculadora",
    label: "Calculadora",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" />
        <line x1="8" y1="7" x2="16" y2="7" />
        <line x1="8" y1="12" x2="8" y2="12" />
        <line x1="12" y1="12" x2="12" y2="12" />
        <line x1="16" y1="12" x2="16" y2="12" />
        <line x1="8" y1="16" x2="8" y2="16" />
        <line x1="12" y1="16" x2="12" y2="16" />
        <line x1="16" y1="16" x2="16" y2="16" />
      </svg>
    ),
  },
  {
    href: "/acessos",
    label: "Acessos",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    ),
  },
];

// Agrupamento do menu por fluxo de trabalho: o dia a dia (conversas e tarefas) em cima, depois CRM,
// automação e análise. Contatos e Empresas são itens próprios (antes ficavam escondidos numa setinha do
// Pipeline). Os itens de configuração ficam num grupo "Workspace" recolhível no fim.
// Grupo com label vazio não desenha cabeçalho.
const NAV_GROUPS: { id: string; label: string; hrefs: string[]; collapsible?: boolean }[] = [
  { id: "main", label: "", hrefs: ["/", "/conversas", "/agenda"] },
  { id: "crm", label: "CRM", hrefs: ["/crm", "/contatos", "/contatos?view=empresas"] },
  { id: "auto", label: "Automação & IA", hrefs: ["/agentes", "/automacoes", "/campanhas", "/templates"] },
  { id: "analise", label: "Análise", hrefs: ["/metricas"] },
  { id: "workspace", label: "Workspace", hrefs: ["/equipe", "/integracoes", "/configuracoes"], collapsible: true },
];

// Agentes nunca aparece pra cliente, em nenhum tipo de acesso — só staff (colaborador+developer)
// mexe nisso. Configurações É liberada pro cliente (só a parte de conectar número — a própria página
// esconde plano/API keys de quem não é staff). Os demais itens seguem o tipo de acesso do cliente
// (accessType null = ainda não classificado, mantém o comportamento antigo de ver tudo).
const STAFF_ONLY_PATHS = new Set(["/agentes"]);

export const SIDEBAR_WIDTH = 211;
export const SIDEBAR_WIDTH_COLLAPSED = 80;

type NavItem = { href: string; label: string; icon: React.ReactNode };

function NavLink({
  href,
  label,
  icon,
  active,
  collapsed,
  badge,
  badgeTone = "danger",
}: NavItem & { active: boolean; collapsed: boolean; badge?: number; badgeTone?: "danger" | "primary" }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      // No estado recolhido o rótulo some da tela, então o nome tem que continuar existindo pro
      // leitor de tela (aria-label) e pro mouse (title). `title` nativo em vez de tooltip própria:
      // a sidebar rola no eixo Y, e qualquer balão desenhado dentro dela seria recortado na borda.
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={`group relative flex items-center rounded-lg text-sm font-semibold transition-colors outline-none
        focus-visible:ring-2 focus-visible:ring-white/70
        ${collapsed ? "justify-center px-0 py-2.5" : "gap-2.5 px-2.5 py-2"}
        ${active ? "bg-sidebar-active-bg text-white" : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"}`}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary" aria-hidden />}
      <span className={`relative ${active ? "text-white" : "text-sidebar-muted group-hover:text-white transition-colors"}`}>
        {icon}
        {collapsed && Boolean(badge) && (
          <span
            className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold leading-4 text-center ${badgeTone === "danger" ? "bg-danger" : "bg-primary"}`}
            aria-hidden
          >
            {badge! > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      {!collapsed && <span className="truncate flex-1">{label}</span>}
      {/* Expandido, o contador vai pra direita do rótulo (como HubSpot/Pipedrive): lê melhor que a bolinha no ícone. */}
      {!collapsed && Boolean(badge) && (
        <span
          className={`min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold leading-5 text-center ${badgeTone === "danger" ? "bg-danger text-white" : "bg-white/15 text-white"}`}
          aria-label={`${badge} pendente(s)`}
        >
          {badge! > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}

function GroupLabel({ children, onClick, open }: { children: React.ReactNode; onClick?: () => void; open?: boolean }) {
  if (!onClick) return <div className="px-2.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted">{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="flex items-center justify-between px-2.5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted hover:text-white cursor-pointer"
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden>
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

// Grupos recolhidos ficam no navegador de quem olha (preferência pessoal, não dado do workspace).
const CHAVE_GRUPOS = "sidebar:closed-groups";
function lerGruposFechados(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || "[]");
  } catch {
    return [];
  }
}

export function Sidebar({
  workspaceSlot,
  workspaceCompact,
  userSlot,
  userCompact,
  isStaff,
  isDeveloper,
  accessType,
  hiddenPages = [],
  attentionCount = 0,
  tasksCount = 0,
  open = false,
  collapsed = false,
  onToggleCollapse,
}: {
  workspaceSlot: React.ReactNode;
  workspaceCompact: React.ReactNode;
  userSlot: React.ReactNode;
  userCompact: React.ReactNode;
  isStaff: boolean;
  isDeveloper: boolean;
  accessType: AccessType | null;
  // Funções desligadas no workspace — somem do menu pra todo mundo, inclusive a agência.
  hiddenPages?: string[];
  attentionCount?: number;
  // Tarefas abertas vencidas ou que vencem hoje.
  tasksCount?: number;
  // Só controla visibilidade em telas < lg (drawer que desliza) — em telas >= lg a sidebar
  // fica sempre visível, igual sempre foi, independente desse valor.
  open?: boolean;
  // Recolhido só existe em telas >= lg: no celular a sidebar já é um drawer que some inteiro, e um
  // trilho de ícones ocupando espaço fixo lá seria só estorvo.
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const emEmpresas = useSearchParams().get("view") === "empresas";
  const [fechados, setFechados] = useState<string[]>([]);
  useEffect(() => setFechados(lerGruposFechados()), []);
  const alternarGrupo = (id: string) => {
    const novo = fechados.includes(id) ? fechados.filter((g) => g !== id) : [...fechados, id];
    setFechados(novo);
    try {
      localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(novo));
    } catch {
      // sem storage: vale só até o reload
    }
  };

  // Empresas é uma visão dentro de /contatos, então o "ativo" olha também o ?view.
  const ativo = (href: string) => {
    if (href === "/contatos?view=empresas") return pathname === "/contatos" && emEmpresas;
    if (href === "/contatos") return pathname === "/contatos" && !emEmpresas;
    return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
  };
  const caminho = (href: string) => (href.startsWith("/contatos?") ? "/empresas" : href);
  const podeVer = (href: string) => {
    const h = caminho(href);
    return !hiddenPages.includes(h) && (isStaff || (!STAFF_ONLY_PATHS.has(h) && canAccessPage(accessType, h, hiddenPages)));
  };
  const itemPorHref = new Map(NAV_ITEMS.map((i) => [i.href, i as NavItem]));
  const badgeDe = (href: string) => (href === "/conversas" ? attentionCount : href === "/agenda" ? tasksCount : undefined);

  const grupos = [
    ...NAV_GROUPS,
    ...(isDeveloper ? [{ id: "agencia", label: "Agência", hrefs: COLABORADOR_NAV_ITEMS.map((i) => i.href), collapsible: true }] : []),
  ]
    .map((g) => ({
      ...g,
      itens: g.hrefs
        .map((h) => itemPorHref.get(h) ?? (COLABORADOR_NAV_ITEMS.find((i) => i.href === h) as NavItem | undefined))
        .filter((i): i is NavItem => i !== undefined && (g.id === "agencia" || podeVer(i.href))),
    }))
    .filter((g) => g.itens.length > 0);

  return (
    <aside
      aria-label="Menu principal"
      className={`flex flex-col fixed inset-y-0 left-0 z-40 py-3 text-sidebar-text overflow-y-auto overflow-x-hidden
        transition-[transform,width] duration-200 ease-out motion-reduce:transition-none lg:translate-x-0
        ${collapsed ? "px-2" : "px-3"} ${open ? "translate-x-0" : "-translate-x-full"}`}
      style={{
        width: collapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH,
        background: "linear-gradient(180deg, var(--color-sidebar) 0%, var(--color-sidebar-deep) 100%)",
      }}
    >
      {/* Marca: recolhida fica só o símbolo, centralizado. O nome some junto com os
          rótulos do menu — manter texto num trilho de 68px só geraria corte no meio da palavra. */}
      <div className={`flex items-center ${collapsed ? "justify-center px-0 py-2 mb-5" : "justify-center gap-1.5 px-5 py-2.5 mb-6 -translate-x-[3.8px]"}`}>
        <Image src="/logo-automax.png" alt="AutomaX" width={45} height={30} className="shrink-0" priority />
        {!collapsed && (
          <div className="leading-tight min-w-0">
            <div className="font-extrabold text-[15px] text-white">AutomaX</div>
          </div>
        )}
      </div>


      <nav className="flex flex-col" aria-label="Seções">
        {grupos.map((grupo) => {
          const fechado = grupo.collapsible && !collapsed && fechados.includes(grupo.id);
          return (
            <div key={grupo.id} className="flex flex-col gap-1">
              {grupo.label &&
                (collapsed ? (
                  // Sem espaço pro rótulo da seção: um filete separa os grupos e preserva o
                  // agrupamento visualmente, em vez de virar uma lista corrida de ícones.
                  <div className="my-1.5 mx-2 border-t border-sidebar-border" aria-hidden />
                ) : (
                  <GroupLabel onClick={grupo.collapsible ? () => alternarGrupo(grupo.id) : undefined} open={!fechado}>
                    {grupo.label}
                  </GroupLabel>
                ))}
              {!fechado &&
                grupo.itens.map((item) => (
                  <NavLink
                    key={item.href}
                    {...item}
                    active={ativo(item.href)}
                    collapsed={collapsed}
                    badge={badgeDe(item.href)}
                    badgeTone={item.href === "/agenda" ? "primary" : "danger"}
                  />
                ))}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-2 pt-3">
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expandir menu" : "Recolher menu"}
            className={`hidden lg:flex items-center rounded-lg text-xs font-semibold text-sidebar-muted
              hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer outline-none
              focus-visible:ring-2 focus-visible:ring-white/70 min-h-[44px]
              ${collapsed ? "justify-center px-0" : "gap-2 px-2.5"}`}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className={`shrink-0 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? "rotate-180" : ""}`}
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <line x1="9" y1="4" x2="9" y2="20" />
              <polyline points="15 10 13 12 15 14" />
            </svg>
            {!collapsed && "Recolher menu"}
          </button>
        )}

        <div className={`rounded-xl bg-white/[0.05] border border-sidebar-border ${collapsed ? "p-2" : "p-3"}`}>
          {!collapsed && <div className="text-[10px] font-bold uppercase tracking-wider text-sidebar-muted mb-2">Workspace atual</div>}
          {collapsed ? workspaceCompact : workspaceSlot}
        </div>

        {collapsed ? userCompact : userSlot}
      </div>
    </aside>
  );
}
