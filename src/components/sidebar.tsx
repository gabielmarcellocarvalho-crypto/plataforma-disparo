"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
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
    href: "/agentes",
    label: "Agentes",
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

function NavLink({
  href,
  label,
  icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={`group relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
        active ? "bg-sidebar-active-bg text-white" : "text-sidebar-text hover:bg-white/[0.06] hover:text-white"
      }`}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-full bg-primary" aria-hidden />}
      <span className={`relative ${active ? "text-white" : "text-sidebar-muted group-hover:text-white transition-colors"}`}>
        {icon}
        {Boolean(badge) && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold leading-4 text-center"
            aria-label={`${badge} ponto(s) de atenção`}
          >
            {badge! > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      {label}
    </Link>
  );
}

// Agentes nunca aparece pra cliente, em nenhum tipo de acesso — só a agência mexe nisso.
// Configurações agora É liberada pro cliente (só a parte de conectar número — a própria página
// esconde plano/API keys de quem não é colaborador). Os demais itens seguem o tipo de acesso do
// cliente (accessType null = ainda não classificado, mantém o comportamento antigo de ver tudo até
// a agência definir o plano dele).
const COLABORADOR_ONLY_PATHS = new Set(["/agentes"]);

export function Sidebar({
  workspaceSlot,
  userSlot,
  isColaborador,
  accessType,
  attentionCount = 0,
  open = false,
}: {
  workspaceSlot: React.ReactNode;
  userSlot: React.ReactNode;
  isColaborador: boolean;
  accessType: AccessType | null;
  attentionCount?: number;
  // Só controla visibilidade em telas < lg (drawer que desliza) — em telas >= lg a sidebar
  // fica sempre visível, igual sempre foi, independente desse valor.
  open?: boolean;
}) {
  const pathname = usePathname();

  const visibleNavItems = isColaborador
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => !COLABORADOR_ONLY_PATHS.has(item.href) && canAccessPage(accessType, item.href));

  return (
    <aside
      className={`w-[250px] flex flex-col fixed inset-y-0 left-0 z-40 p-3.5 gap-1 text-sidebar-text overflow-y-auto transition-transform duration-200 ease-out lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
      style={{ background: "linear-gradient(180deg, var(--color-sidebar) 0%, var(--color-sidebar-deep) 100%)" }}
    >
      <div className="flex items-center gap-2.5 px-2 py-3 mb-3">
        <Image src="/logo-automax.png" alt="AutomaX" width={40} height={27} className="shrink-0" priority />
        <div className="leading-tight">
          <div className="font-extrabold text-[15px] text-white">AutomaX</div>
          <div className="text-[11px] text-sidebar-muted">Automatize processos. Multiplique resultados</div>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        {visibleNavItems.map((item) => (
          <NavLink key={item.href} {...item} active={pathname === item.href} badge={item.href === "/conversas" ? attentionCount : undefined} />
        ))}
      </nav>

      {isColaborador && (
        <>
          <div className="mt-5 mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-sidebar-muted">Agência</div>
          <nav className="flex flex-col gap-1">
            {COLABORADOR_NAV_ITEMS.map((item) => (
              <NavLink key={item.href} {...item} active={pathname === item.href} />
            ))}
          </nav>
        </>
      )}

      <div className="mt-auto rounded-xl p-3 bg-white/[0.05] border border-sidebar-border">
        <div className="text-[10px] font-bold uppercase tracking-wider text-sidebar-muted mb-2">Workspace atual</div>
        {workspaceSlot}
      </div>

      {userSlot}
    </aside>
  );
}
