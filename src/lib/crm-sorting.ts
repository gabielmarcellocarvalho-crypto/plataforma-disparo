// Ordenação dos cards do Pipeline. Vale dentro de cada coluna do Kanban e na visão de lista.
//
// A ordenação é escolha de quem está olhando, não configuração do workspace: um dia se procura o
// lead que chegou agora, no outro o que está parado há mais tempo. Por isso mora no estado da tela,
// não no banco.

export type SortKey =
  | "recentes"
  | "antigos"
  | "alfabetica"
  | "parados"
  | "proxima_tarefa"
  | "mais_interacoes"
  | "menos_interacoes";

export const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "recentes", label: "Entraram por último" },
  { key: "antigos", label: "Entraram primeiro" },
  { key: "alfabetica", label: "Ordem alfabética" },
  { key: "parados", label: "Parados há mais tempo" },
  { key: "proxima_tarefa", label: "Próxima tarefa" },
  { key: "mais_interacoes", label: "Mais conversados" },
  { key: "menos_interacoes", label: "Menos conversados" },
];

export type SortableContact = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
  stage_changed_at: string;
};

export type ActivityMaps = {
  // Vencimento da próxima tarefa aberta de cada contato (ISO). Ausente = sem tarefa.
  nextTaskAt: Map<string, string>;
  // Quantas mensagens trocadas. Ausente = nenhuma.
  interactions: Map<string, number>;
};

function rotulo(c: SortableContact): string {
  return (c.name || c.phone || c.email || "").trim().toLowerCase();
}

export function sortContacts<T extends SortableContact>(contatos: T[], key: SortKey, atividade: ActivityMaps): T[] {
  const lista = [...contatos];

  switch (key) {
    case "antigos":
      return lista.sort((a, b) => a.created_at.localeCompare(b.created_at));

    case "alfabetica":
      // localeCompare com "pt-BR" pra acento não jogar nome pro fim da lista ("Ângela" antes de "Ana"
      // é o que aconteceria comparando por código de caractere).
      return lista.sort((a, b) => rotulo(a).localeCompare(rotulo(b), "pt-BR"));

    case "parados":
      // Quem mudou de fase há mais tempo primeiro: é a fila de quem está esquecido.
      return lista.sort((a, b) => a.stage_changed_at.localeCompare(b.stage_changed_at));

    case "proxima_tarefa": {
      // Vencimento mais próximo primeiro. Quem não tem tarefa vai pro FIM em vez de sumir — a
      // ordenação serve pra priorizar, não pra filtrar.
      return lista.sort((a, b) => {
        const ta = atividade.nextTaskAt.get(a.id);
        const tb = atividade.nextTaskAt.get(b.id);
        if (ta && tb) return ta.localeCompare(tb);
        if (ta) return -1;
        if (tb) return 1;
        return b.created_at.localeCompare(a.created_at);
      });
    }

    case "mais_interacoes":
      return lista.sort((a, b) => (atividade.interactions.get(b.id) ?? 0) - (atividade.interactions.get(a.id) ?? 0));

    case "menos_interacoes":
      return lista.sort((a, b) => (atividade.interactions.get(a.id) ?? 0) - (atividade.interactions.get(b.id) ?? 0));

    case "recentes":
    default:
      return lista.sort((a, b) => b.created_at.localeCompare(a.created_at));
  }
}
