// Quem enxerga o quê. Duas camadas, de propósito:
//
// 1. `hidden_pages` do WORKSPACE — funções que aquele cliente não usa. Vale pra todo mundo que
//    trabalha nele, inclusive a agência: se o cliente não tem agente de IA, "Agentes" não deveria
//    ocupar espaço no menu de ninguém. É marcado na mão na criação do cliente.
// 2. `access_type` do PERFIL — até onde vai o acesso de um login de cliente dentro do que sobrou.
//    A equipe da agência (colaborador/developer) nunca é restrita por isso.
//
// A plataforma é um CRM; o agente de IA é uma função dentro dela. Por isso nada aqui presume que o
// agente existe — um workspace pode ser 100% CRM manual e continuar íntegro.

export type AccessType = "disparo_avulso" | "sdr" | "closer" | "sdr_light" | "ultra";

// Funções que podem ser ocultadas por workspace. "/" e "/configuracoes" ficam de fora: sem a Visão
// geral não há para onde entrar, e sem Configurações o cliente não consegue nem reconectar o número.
export const PAGE_CATALOG: { path: string; label: string; hint: string }[] = [
  { path: "/conversas", label: "Conversas", hint: "caixa de entrada do WhatsApp" },
  { path: "/crm", label: "Pipeline", hint: "funil de leads em Kanban" },
  { path: "/contatos", label: "Contatos", hint: "base de leads e importação de planilha" },
  { path: "/empresas", label: "Empresas", hint: "organizações às quais os contatos pertencem" },
  { path: "/equipe", label: "Equipe", hint: "filiais, pessoas e territórios" },
  { path: "/agenda", label: "Agenda", hint: "tarefas com data" },
  { path: "/automacoes", label: "Automações", hint: "fluxos automáticos sobre os leads" },
  { path: "/campanhas", label: "Campanhas", hint: "disparo em massa de WhatsApp e e-mail" },
  { path: "/metricas", label: "Métricas", hint: "relatórios de leads e de custo" },
  { path: "/agentes", label: "Agentes de IA", hint: "atendimento automático — desligue se o cliente não usa" },
];

const CATALOG_PATHS = new Set(PAGE_CATALOG.map((p) => p.path));

// Planos comerciais, agora no papel de ATALHO: escolher um pré-marca as funções ocultas na criação
// do cliente, e dali em diante a lista é editável na mão.
export const ACCESS_TYPES: { key: AccessType; label: string; pages: string[] }[] = [
  { key: "disparo_avulso", label: "Disparo Avulso", pages: ["/", "/conversas", "/crm", "/empresas", "/equipe", "/agenda", "/automacoes", "/contatos", "/campanhas", "/configuracoes"] },
  { key: "sdr", label: "SDR", pages: ["/", "/conversas", "/crm", "/empresas", "/equipe", "/agenda", "/automacoes", "/contatos", "/metricas", "/configuracoes"] },
  { key: "closer", label: "Closer", pages: ["/", "/conversas", "/crm", "/empresas", "/equipe", "/agenda", "/automacoes", "/contatos", "/metricas", "/configuracoes"] },
  { key: "sdr_light", label: "SDR LIGHT", pages: ["/", "/conversas", "/crm", "/empresas", "/equipe", "/agenda", "/automacoes", "/contatos", "/metricas", "/campanhas", "/configuracoes"] },
  { key: "ultra", label: "Ultra", pages: ["/", "/conversas", "/crm", "/empresas", "/equipe", "/agenda", "/automacoes", "/contatos", "/metricas", "/campanhas", "/configuracoes"] },
];

const PAGES_BY_TYPE = new Map(ACCESS_TYPES.map((t) => [t.key, new Set(t.pages)]));

export function isAccessType(value: unknown): value is AccessType {
  return typeof value === "string" && PAGES_BY_TYPE.has(value as AccessType);
}

export function accessTypeLabel(type: AccessType): string {
  return ACCESS_TYPES.find((t) => t.key === type)?.label ?? type;
}

// O que um plano ocultaria, pra usar como sugestão inicial na criação do cliente.
export function hiddenPagesForPlan(type: AccessType): string[] {
  const visiveis = PAGES_BY_TYPE.get(type) ?? new Set<string>();
  return PAGE_CATALOG.map((p) => p.path).filter((path) => !visiveis.has(path));
}

// Aceita só caminhos do catálogo: guardar qualquer string aqui deixaria a lista sem sentido e
// poderia esconder uma página que nunca deveria sumir.
export function resolveHiddenPages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((v) => String(v ?? "")).filter((v) => CATALOG_PATHS.has(v)))];
}

// `accessType` null = sem restrição de plano (equipe da agência, ou cliente ainda não classificado).
// `hiddenPages` vale pra todos, e é checado primeiro.
export function canAccessPage(accessType: AccessType | null, path: string, hiddenPages: string[] = []): boolean {
  if (hiddenPages.includes(path)) return false;
  if (accessType === null) return true;
  return PAGES_BY_TYPE.get(accessType)?.has(path) ?? false;
}
