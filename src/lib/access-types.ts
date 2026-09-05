// Tipos de acesso vendáveis pro cliente — cada um mapeia num plano comercial e controla quais
// páginas do menu ficam visíveis/acessíveis (Agentes e Configurações nunca aparecem pra cliente,
// em nenhum tipo — só a agência mexe nisso). Colaborador nunca é restrito por isso, vê tudo sempre.
export type AccessType = "disparo_avulso" | "sdr" | "closer" | "sdr_light" | "ultra";

// "/configuracoes" entra em todo tipo de acesso — o cliente pode reconectar o próprio número (QR
// expirado, troca de aparelho) sem depender da agência. A página em si já esconde as seções de
// agência (plano, API keys) do cliente, mesmo com a rota liberada aqui.
// "/empresas" entra em todo tipo de acesso, ao lado de "/crm" — faz parte do CRM que o cliente já paga
// (Empresas + Tarefas), não é feature nova a monetizar separadamente. "/equipe" segue a mesma regra:
// é o cadastro de quem pode ficar responsável por um lead, sem o qual o Pipeline fica manco.
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

// null = sem restrição (colaborador, ou cliente ainda não classificado — ver nota na migration).
export function canAccessPage(accessType: AccessType | null, path: string): boolean {
  if (accessType === null) return true;
  return PAGES_BY_TYPE.get(accessType)?.has(path) ?? false;
}
