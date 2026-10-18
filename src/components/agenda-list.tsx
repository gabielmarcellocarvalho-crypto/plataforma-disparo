"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { toggleTaskCompleted, type AgendaTask } from "@/app/actions/tasks";
import { formatFieldValue, type CustomFieldType } from "@/lib/custom-fields";
import { isTaskOverdue, groupTasksByDay, type TaskGroup } from "@/lib/tasks";

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

type TabKey = "atrasadas" | "hoje" | "proximos" | "concluidas";
const TABS: [TabKey, string, string][] = [
  ["atrasadas", "Atrasadas", "bg-danger-soft text-danger"],
  ["hoje", "Hoje", "bg-primary-faint text-primary-strong"],
  ["proximos", "Próximas", "bg-surface-2 text-text-muted"],
  ["concluidas", "Concluídas", "bg-success-soft text-success"],
];

// Semana (seg a dom) com as tarefas de cada dia; clicar marca/desmarca como concluída.
function WeekView({
  tasks,
  offset,
  onOffset,
  onToggle,
}: {
  tasks: Task[];
  offset: number;
  onOffset: (n: number) => void;
  onToggle: (id: string, completed: boolean) => void;
}) {
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const today = new Date().toDateString();
  const label = `${days[0].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} – ${days[6].toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}`;
  const navBtn = "h-8 px-2.5 rounded-md border border-border text-xs font-bold hover:bg-surface-2 cursor-pointer";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button type="button" className={navBtn} onClick={() => onOffset(offset - 1)} aria-label="Semana anterior">‹</button>
        <button type="button" className={navBtn} onClick={() => onOffset(0)}>Esta semana</button>
        <button type="button" className={navBtn} onClick={() => onOffset(offset + 1)} aria-label="Próxima semana">›</button>
        <span className="text-sm font-semibold text-text-muted">{label}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-7 min-w-[760px] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
          {days.map((d) => {
            const items = tasks.filter((t) => t.due_at && new Date(t.due_at).toDateString() === d.toDateString());
            const isToday = d.toDateString() === today;
            return (
              <div key={d.toISOString()} className="min-h-72 border-r border-border last:border-r-0">
                <div className={`border-b border-border px-2.5 py-2 text-xs font-bold capitalize ${isToday ? "bg-primary-faint text-primary-strong" : "text-text-muted"}`}>
                  {d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit" })}
                </div>
                <div className="flex flex-col gap-1.5 p-1.5">
                  {items.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onToggle(t.id, !t.completed_at)}
                      title={t.completed_at ? "Marcar como pendente" : "Marcar como concluída"}
                      className={`w-full text-left rounded border-l-[3px] px-2 py-1.5 text-[11px] cursor-pointer ${
                        t.completed_at
                          ? "border-success bg-success-soft/50 text-text-muted line-through"
                          : isTaskOverdue(t.due_at, t.completed_at)
                            ? "border-danger bg-danger-soft/60"
                            : "border-primary bg-primary-faint"
                      }`}
                    >
                      <b>{new Date(t.due_at!).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</b> {t.title}
                      {(t.contact_name || t.company_name) && <span className="block text-text-muted truncate">{t.contact_name || t.company_name}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Cor de destaque por grupo — mesmo padrão visual de "prioridade" já usado nos badges de data
// (bg-danger-soft pra atrasada); dá pra escanear a lista sem ler o rótulo do grupo.
const GROUP_ACCENT: Record<TaskGroup | TabKey, string> = {
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
  // Abas no lugar da lista corrida: quem abre a tela quer ver primeiro o que está atrasado ou é pra hoje.
  const [tab, setTab] = useState<TabKey>(() => {
    const g = groupTasksByDay(initialTasks);
    return g.atrasadas.length > 0 ? "atrasadas" : "hoje";
  });
  const [mode, setMode] = useState<"lista" | "semana">("lista");
  const [weekOffset, setWeekOffset] = useState(0);
  const tabItems = (k: TabKey) => (k === "proximos" ? [...groups.proximos, ...groups.sem_data] : groups[k]);

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

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex rounded-md border border-border bg-surface p-0.5">
          {(["lista", "semana"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`h-8 px-3 rounded text-xs font-bold cursor-pointer ${mode === m ? "bg-primary-strong text-white" : "text-text-muted hover:text-text"}`}
            >
              {m === "lista" ? "Lista" : "Semana"}
            </button>
          ))}
        </div>
      </div>

      {mode === "lista" ? (
        <div className="bg-surface border border-border rounded-lg shadow-sm">
          <nav className="flex gap-1 border-b border-border px-3 overflow-x-auto" aria-label="Filtro de tarefas">
            {TABS.map(([k, label, tone]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-semibold whitespace-nowrap cursor-pointer ${
                  tab === k ? "border-primary-strong text-text" : "border-transparent text-text-muted hover:text-text"
                }`}
              >
                {label}
                <span className={`text-[11px] font-bold px-1.5 rounded-full ${tone}`}>{tabItems(k).length}</span>
              </button>
            ))}
          </nav>
          <div className="flex flex-col gap-1.5 p-3">
            {tabItems(tab).map((t) => (
              <TaskRow key={t.id} task={t} onToggle={handleToggle} accent={GROUP_ACCENT[tab]} fieldDefs={fieldDefs} />
            ))}
            {tabItems(tab).length === 0 && filtered.length > 0 && <p className="py-10 text-center text-sm text-text-muted">Nada nesta aba.</p>}
          </div>
        </div>
      ) : (
        <WeekView tasks={filtered} offset={weekOffset} onOffset={setWeekOffset} onToggle={handleToggle} />
      )}

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
