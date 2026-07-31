// Tipos de acesso vendáveis pro cliente — cada um mapeia num plano comercial e controla quais
// páginas do menu ficam visíveis/acessíveis (Agentes e Configurações nunca aparecem pra cliente,
// em nenhum tipo — só a agência mexe nisso). Colaborador nunca é restrito por isso, vê tudo sempre.
export type AccessType = "disparo_avulso" | "sdr" | "closer" | "sdr_light" | "ultra";

export const ACCESS_TYPES: { key: AccessType; label: string; pages: string[] }[] = [
  { key: "disparo_avulso", label: "Disparo Avulso", pages: ["/", "/conversas", "/crm", "/contatos", "/campanhas"] },
  { key: "sdr", label: "SDR", pages: ["/", "/conversas", "/crm", "/contatos", "/metricas"] },
  { key: "closer", label: "Closer", pages: ["/", "/conversas", "/crm", "/contatos", "/metricas"] },
  { key: "sdr_light", label: "SDR LIGHT", pages: ["/", "/conversas", "/crm", "/contatos", "/metricas", "/campanhas"] },
  { key: "ultra", label: "Ultra", pages: ["/", "/conversas", "/crm", "/contatos", "/metricas", "/campanhas"] },
];

const PAGES_BY_TYPE = new Map(ACCESS_TYPES.map((t) => [t.key, new Set(t.pages)]));

export function isAccessType(value: unknown): value is AccessType {
  return typeof value === "string" && PAGES_BY_TYPE.has(value as AccessType);
}

export function accessTypeLabel(type: AccessType): string {
  return ACCESS_TYPES.find((t) => t.key === type)?.label ?? type;
}

// null = sem restrição (colaborador, ou cliente ainda não classificado — ver nota na migration).
export function canAccessPage(accessType: AccessType | null, path: string): boolean {
  if (accessType === null) return true;
  return PAGES_BY_TYPE.get(accessType)?.has(path) ?? false;
}
