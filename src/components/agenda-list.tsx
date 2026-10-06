"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toggleTaskCompleted, type AgendaTask } from "@/app/actions/tasks";
import { formatFieldValue, type CustomFieldType } from "@/lib/custom-fields";
import { isTaskOverdue, groupTasksByDay, TASK_GROUP_LABELS, type TaskGroup } from "@/lib/tasks";

type Task = AgendaTask;

type Responsible = { id: string; name: string };
type FieldDef = { key: string; label: string; type: CustomFieldType };

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Card do lead de uma tarefa criada pelo agente: campos mapeados, resumo da conversa, atalho pra
// conversa e pro WhatsApp, e o número pra copiar. Abre e fecha pra não alongar a fila.
function AgentTaskDetails({ task, fieldDefs }: { task: Task; fieldDefs: FieldDef[] }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const digits = (task.contact_phone ?? "").replace(/\D/g, "");

  const fields = fieldDefs
    .map((d) => ({ def: d, raw: task.contact_custom_fields?.[d.key] }))
    .filter(({ raw }) => raw !== null && raw !== undefined && raw !== "")
    .map(({ def, raw }) => ({ label: def.label, value: formatFieldValue(def, raw) }));

  async function copy() {
    try {
      await navigator.clipboard.writeText(digits);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sem permissão de área de transferência: o número continua visível pra copiar na mão.
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        {task.contact_id && (
          <Link
            href={`/conversas?contact=${task.contact_id}`}
            className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-primary-faint text-primary-strong hover:underline"
          >
            Ver conversa
          </Link>
        )}
        {digits && (
          <>
            <a
              href={`https://wa.me/${digits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-bold px-2.5 py-1 rounded-md bg-success-soft text-success hover:underline"
            >
              Abrir WhatsApp
            </a>
            <span className="text-[11px] font-mono text-text-muted">+{digits}</span>
            <button
              type="button"
              onClick={copy}
              className="text-[11px] font-bold px-2 py-1 rounded-md border border-border hover:bg-surface-2 cursor-pointer"
            >
              {copied ? "Copiado" : "Copiar número"}
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto text-[11px] font-bold text-text-muted hover:text-text cursor-pointer"
        >
          {open ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-3 bg-surface-2 rounded-md p-3">
          {fields.length > 0 && (
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {fields.map((f) => (
                <div key={f.label} className="min-w-0">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-text-muted">{f.label}</dt>
                  <dd className="text-xs break-words">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          {task.conversation_summary && (
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1">Resumo da conversa</div>
              <p className="text-xs whitespace-pre-line">{task.conversation_summary}</p>
            </div>
          )}
          {fields.length === 0 && !task.conversation_summary && <p className="text-xs text-text-muted">Sem dados coletados ainda.</p>}
        </div>
      )}
    </div>
  );
}

const GROUP_ORDER: TaskGroup[] = ["atrasadas", "hoje", "proximos", "sem_data", "concluidas"];

// Cor de destaque por grupo — mesmo padrão visual de "prioridade" já usado nos badges de data
// (bg-danger-soft pra atrasada); dá pra escanear a lista sem ler o rótulo do grupo.
const GROUP_ACCENT: Record<TaskGroup, string> = {
  atrasadas: "border-l-danger",
  hoje: "border-l-primary",
  proximos: "border-l-border",
  sem_data: "border-l-border",
  concluidas: "border-l-success",
};

function TaskRow({
  task,
  onToggle,
  accent,
  fieldDefs,
}: {
  task: Task;
  onToggle: (id: string, completed: boolean) => void;
  accent: string;
  fieldDefs: FieldDef[];
}) {
  const fromAgent = task.source === "agente";
  const overdue = isTaskOverdue(task.due_at, task.completed_at);
  const link = task.company_name ? "/empresas" : task.contact_name ? "/crm" : null;
  const linkLabel = task.company_name || task.contact_name;

  return (
    <div className={`flex items-start gap-3 bg-surface border border-l-[3px] border-border ${accent} rounded-lg px-3 py-2.5`}>
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
              {fromAgent ? formatDateTime(task.due_at) : formatDateShort(task.due_at)}
            </span>
          )}
          {fromAgent && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-faint text-primary-strong">Agente</span>}
          {task.team_member_name && <span className="text-[11px] text-text-muted truncate">{task.team_member_name}</span>}
          {!fromAgent && link && linkLabel && (
            <Link href={link} className="text-[11px] text-primary-strong hover:underline truncate">
              {linkLabel}
            </Link>
          )}
        </div>
        {fromAgent && <AgentTaskDetails task={task} fieldDefs={fieldDefs} />}
      </div>
    </div>
  );
}

export function AgendaList({
  tasks: initialTasks,
  responsibles,
  sellers = [],
  fieldDefs = [],
}: {
  tasks: Task[];
  responsibles: Responsible[];
  sellers?: Responsible[];
  fieldDefs?: FieldDef[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [sellerFilter, setSellerFilter] = useState("");
  const [, startTransition] = useTransition();

  const filtered = useMemo(
    () =>
      tasks.filter(
        (t) => (!responsibleFilter || t.responsible_user_id === responsibleFilter) && (!sellerFilter || t.team_member_id === sellerFilter)
      ),
    [tasks, responsibleFilter, sellerFilter]
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
      {(responsibles.length > 0 || sellers.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {responsibles.length > 0 && (
            <select
              value={responsibleFilter}
              onChange={(e) => setResponsibleFilter(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
            >
              <option value="">Responsável: todos</option>
              {responsibles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
          {sellers.length > 0 && (
            <select
              value={sellerFilter}
              onChange={(e) => setSellerFilter(e.target.value)}
              className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary cursor-pointer bg-surface"
            >
              <option value="">Vendedor: todos</option>
              {sellers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
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
                <TaskRow key={t.id} task={t} onToggle={handleToggle} accent={GROUP_ACCENT[key]} fieldDefs={fieldDefs} />
              ))}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 flex flex-col items-center text-center gap-2">
          <span className="grid place-items-center w-12 h-12 rounded-full bg-primary-faint text-primary-strong" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="m9 16 2 2 4-4" />
            </svg>
          </span>
          <p className="font-semibold text-text">Nenhuma tarefa por aqui</p>
          <p className="text-sm text-text-muted max-w-xs">
            Crie uma tarefa com o botão &quot;+ Tarefa&quot; acima, ou direto pelo drawer de um contato/empresa.
          </p>
        </div>
      )}
    </div>
  );
}
