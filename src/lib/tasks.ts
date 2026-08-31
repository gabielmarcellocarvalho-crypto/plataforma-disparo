// Helpers de Tarefas/Atividades — conceito paralelo a crm-stages.ts, sem estágio nenhum (só
// pendente/concluída + data de vencimento).
export type TaskGroup = "atrasadas" | "hoje" | "proximos" | "sem_data" | "concluidas";

export function isTaskOverdue(dueAt: string | null, completedAt: string | null): boolean {
  if (!dueAt || completedAt) return false;
  return new Date(dueAt) < new Date(new Date().toDateString());
}

function isToday(dueAt: string): boolean {
  const d = new Date(dueAt);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

export function groupForTask(dueAt: string | null, completedAt: string | null): TaskGroup {
  if (completedAt) return "concluidas";
  if (!dueAt) return "sem_data";
  if (isTaskOverdue(dueAt, completedAt)) return "atrasadas";
  if (isToday(dueAt)) return "hoje";
  return "proximos";
}

export function groupTasksByDay<T extends { due_at: string | null; completed_at: string | null }>(
  tasks: T[]
): Record<TaskGroup, T[]> {
  const groups: Record<TaskGroup, T[]> = { atrasadas: [], hoje: [], proximos: [], sem_data: [], concluidas: [] };
  for (const task of tasks) groups[groupForTask(task.due_at, task.completed_at)].push(task);
  return groups;
}

export const TASK_GROUP_LABELS: Record<TaskGroup, string> = {
  atrasadas: "Atrasadas",
  hoje: "Hoje",
  proximos: "Próximos dias",
  sem_data: "Sem data",
  concluidas: "Concluídas",
};
