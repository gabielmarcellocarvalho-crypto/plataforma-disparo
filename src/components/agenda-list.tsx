"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toggleTaskCompleted } from "@/app/actions/tasks";
import { isTaskOverdue, groupTasksByDay, TASK_GROUP_LABELS, type TaskGroup } from "@/lib/tasks";

type Task = {
  id: string;
  title: string;
  description: string | null;
  due_at: string | null;
  completed_at: string | null;
  contact_id: string | null;
  contact_name: string | null;
  company_id: string | null;
  company_name: string | null;
  deal_id: string | null;
  deal_name: string | null;
  responsible_user_id: string | null;
};

type Responsible = { id: string; name: string };

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const GROUP_ORDER: TaskGroup[] = ["atrasadas", "hoje", "proximos", "sem_data", "concluidas"];

function TaskRow({ task, onToggle }: { task: Task; onToggle: (id: string, completed: boolean) => void }) {
  const overdue = isTaskOverdue(task.due_at, task.completed_at);
  const link = task.deal_name ? "/negocios" : task.company_name ? "/empresas" : task.contact_name ? "/crm" : null;
  const linkLabel = task.deal_name || task.company_name || task.contact_name;

  return (
    <div className="flex items-start gap-3 bg-surface border border-border rounded-lg px-3 py-2.5">
      <input
        type="checkbox"
        checked={Boolean(task.completed_at)}
        onChange={(e) => onToggle(task.id, e.target.checked)}
        className="mt-0.5 cursor-pointer"
      />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold truncate ${task.completed_at ? "line-through text-text-muted" : ""}`}>{task.title}</div>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {task.due_at && (
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${overdue ? "bg-danger-soft text-danger" : "bg-surface-2 text-text-muted"}`}>
              {formatDateShort(task.due_at)}
            </span>
          )}
          {link && linkLabel && (
            <Link href={link} className="text-[11px] text-primary-strong hover:underline truncate">
              {linkLabel}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function AgendaList({ tasks: initialTasks, responsibles }: { tasks: Task[]; responsibles: Responsible[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(
    () => (responsibleFilter ? tasks.filter((t) => t.responsible_user_id === responsibleFilter) : tasks),
    [tasks, responsibleFilter]
  );

  const groups = useMemo(() => groupTasksByDay(filtered), [filtered]);

  function handleToggle(id: string, completed: boolean) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed_at: completed ? new Date().toISOString() : null } : t)));
    startTransition(async () => {
      await toggleTaskCompleted(id, completed);
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {responsibles.length > 0 && (
        <select
          value={responsibleFilter}
          onChange={(e) => setResponsibleFilter(e.target.value)}
          className="self-start border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
        >
          <option value="">Responsável: todos</option>
          {responsibles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      )}

      {GROUP_ORDER.map((key) => {
        const items = groups[key];
        if (items.length === 0) return null;
        return (
          <div key={key} className="flex flex-col gap-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-text-muted">
              {TASK_GROUP_LABELS[key]} <span className="opacity-60">({items.length})</span>
            </h3>
            <div className="flex flex-col gap-1.5">
              {items.map((t) => (
                <TaskRow key={t.id} task={t} onToggle={handleToggle} />
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && <p className="text-sm text-text-muted">Nenhuma tarefa por aqui.</p>}
    </div>
  );
}
