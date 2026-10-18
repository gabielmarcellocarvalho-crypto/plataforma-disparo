// Salvar uma automação recria todos os passos (ids novos). Sem remapear, quem estava no meio dela perde
// o passo atual (a FK zera current_step_id) e o motor encerra a execução como "concluída" sem enviar
// nada. Aqui está a chave estável de cada passo — posição no topo, ou posição dentro do ramo sim/não de
// uma condição — pra ligar o passo antigo ao novo equivalente.

export type StepPlace = { id: string; parent_step_id: string | null; branch: string | null; position: number };

export function stepKeys(rows: StepPlace[]): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, string>(); // id -> chave
  for (const r of rows) {
    if (!r.parent_step_id) out.set(r.id, `t:${r.position}`);
    else {
      const parent = byId.get(r.parent_step_id);
      if (parent) out.set(r.id, `c:${parent.position}:${r.branch}:${r.position}`);
    }
  }
  return out;
}

// Pra cada passo antigo, o id do novo passo na mesma posição (ou null se a posição deixou de existir).
export function remapStepIds(oldRows: StepPlace[], newRows: StepPlace[]): Map<string, string | null> {
  const oldKeys = stepKeys(oldRows);
  const newIdByKey = new Map([...stepKeys(newRows).entries()].map(([id, key]) => [key, id]));
  const out = new Map<string, string | null>();
  for (const [oldId, key] of oldKeys) out.set(oldId, newIdByKey.get(key) ?? null);
  return out;
}
