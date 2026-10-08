// Catálogo das permissões da Nuvemshop. Vive em código de propósito: acrescentar uma permissão não
// exige migration. O workspace liga as que quer em Integrações; cada agente liga as que usa na aba
// Integrações dele. Efetivo = ligada nos dois.
//
// `available: false` aparece travada na tela ("em breve"). Nenhuma permissão de escrita está
// disponível: a loja é de cliente real e a v1 só consulta (spec 2026-10-07).

export type Capability = {
  id: string;
  label: string;
  kind: "leitura" | "escrita";
  available: boolean;
  // Explicação na tela de Integrações.
  description: string;
  // Observação que aparece embaixo do botão na aba Integrações do agente.
  agentNote: string;
};

export const NUVEMSHOP_PROVIDER = "nuvemshop";

export const NUVEMSHOP_CAPABILITIES: Capability[] = [
  {
    id: "nuvemshop.pedidos.consultar",
    label: "Consultar pedidos",
    kind: "leitura",
    available: true,
    description: "O agente vê status, pagamento, envio e itens do pedido de quem está na conversa.",
    agentNote:
      "Isso serve para consultar pedidos: o agente informa status, pagamento, envio e itens do pedido do cliente que está na conversa. Só mostra pedido do próprio cliente.",
  },
  {
    id: "nuvemshop.produtos.consultar",
    label: "Consultar produtos",
    kind: "leitura",
    available: true,
    description: "O agente vê preço, estoque e link dos produtos da loja.",
    agentNote: "Isso serve para consultar produtos: o agente informa preço, disponibilidade em estoque e o link do produto.",
  },
  {
    id: "nuvemshop.pedidos.fechar",
    label: "Fechar pedido",
    kind: "escrita",
    available: false,
    description: "Marcar o pedido como concluído na loja.",
    agentNote: "Isso serve para fechar pedidos na loja.",
  },
  {
    id: "nuvemshop.pedidos.cancelar",
    label: "Cancelar pedido",
    kind: "escrita",
    available: false,
    description: "Cancelar o pedido na loja.",
    agentNote: "Isso serve para cancelar pedidos na loja.",
  },
  {
    id: "nuvemshop.pedidos.nota",
    label: "Anotar no pedido",
    kind: "escrita",
    available: false,
    description: "Gravar uma observação interna no pedido.",
    agentNote: "Isso serve para anotar observações internas nos pedidos.",
  },
];

const BY_ID = new Map(NUVEMSHOP_CAPABILITIES.map((c) => [c.id, c]));

export function getCapability(id: string): Capability | undefined {
  return BY_ID.get(id);
}

// Efetivo = ligada no workspace E no agente E disponível. Desligar no workspace tira do agente na hora.
export function effectiveCapabilityIds(workspaceIds: unknown, agentIds: unknown): Set<string> {
  const agent = new Set(sanitizeCapabilityIds(agentIds));
  return new Set(sanitizeCapabilityIds(workspaceIds).filter((id) => agent.has(id)));
}

// Só ids que existem E estão disponíveis. Qualquer outra coisa que chegue do cliente (ou que já
// estivesse salva e tenha sido travada depois) é descartada aqui.
export function sanitizeCapabilityIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.map((v) => String(v ?? "")).filter((id) => BY_ID.get(id)?.available);
  return [...new Set(ids)];
}
