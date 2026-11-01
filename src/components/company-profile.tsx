"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  updateCompanyInfo,
  addCompanyNote,
  deleteCompany,
  linkContactToCompany,
  searchContactsToLink,
  type CompanyDetail,
  type CompanyNote,
  type LinkableContact,
} from "@/app/actions/companies";
import { quickCreateTask, toggleTaskCompleted, type TaskRow } from "@/app/actions/tasks";
import { isTaskOverdue } from "@/lib/tasks";

export type CompanyLead = {
  id: string;
  name: string;
  phone: string | null;
  stageLabel: string;
  status: "open" | "won" | "lost";
  value: number;
  responsible: string | null;
  createdAt: string;
};

type Metrics = { open: number; won: number; lost: number; total: number; ticket: number | null; daysToSale: number | null };
type ContactRef = { id: string; label: string; phone: string | null };
type FieldRow = { key: string; value: string };

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dateBr = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dateTimeBr = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

const input = "w-full border border-border rounded-md px-2.5 py-1.5 text-sm outline-none focus:border-primary bg-surface";

const STATUS_STYLE: Record<CompanyLead["status"], { label: string; cls: string }> = {
  open: { label: "Em andamento", cls: "bg-info-soft text-info-text" },
  won: { label: "Ganho", cls: "bg-success-soft text-success" },
  lost: { label: "Perdido", cls: "bg-danger-soft text-danger" },
};

function Section({ title, defaultOpen = true, children, action }: { title: string; defaultOpen?: boolean; children: React.ReactNode; action?: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border first:border-t-0 py-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 flex-1 text-left text-sm font-bold cursor-pointer">
          {title}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`ml-auto text-text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
        {action}
      </div>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function Row({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[110px_1fr] items-center gap-2 text-sm">
      <span className="text-text-muted">
        {label}
        {required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "info" | "success" | "danger" | "plain" }) {
  const bg = { info: "bg-info-soft", success: "bg-success-soft", danger: "bg-danger-soft", plain: "bg-surface-2" }[tone];
  return (
    <div className={`rounded-lg border border-border p-4 ${bg}`}>
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <p className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums">{value}</p>
    </div>
  );
}

export function CompanyProfile({
  company,
  notes,
  contacts,
  leads,
  metrics,
  tasks,
}: {
  company: CompanyDetail;
  notes: CompanyNote[];
  contacts: ContactRef[];
  leads: CompanyLead[];
  metrics: Metrics;
  tasks: TaskRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"negociacoes" | "tarefas">("negociacoes");

  const [form, setForm] = useState({
    name: company.name || "",
    industry: company.industry || "",
    cnpj: company.cnpj || "",
    website: company.website || "",
    domain: company.domain || "",
    phone: company.phone || "",
    address: company.address || "",
    city: company.city || "",
    state: company.state || "",
    zip: company.zip || "",
  });
  const [fields, setFields] = useState<FieldRow[]>(Object.entries(company.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) })));
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [noteDraft, setNoteDraft] = useState("");
  const [taskDraft, setTaskDraft] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<LinkableContact[]>([]);
  const [localTasks, setLocalTasks] = useState(tasks);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
    setSaved(false);
  };

  function save() {
    setError(null);
    setSaved(false);
    const customFields = Object.fromEntries(fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value.trim()]));
    startTransition(async () => {
      const result = await updateCompanyInfo(company.id, { ...form, customFields });
      if (result.error) setError(result.error);
      else {
        setSaved(true);
        setDirty(false);
        router.refresh();
      }
    });
  }

  function addNote() {
    const content = noteDraft.trim();
    if (!content) return;
    setNoteDraft("");
    startTransition(async () => {
      const result = await addCompanyNote(company.id, content);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function addTask() {
    const title = taskDraft.trim();
    if (!title) return;
    setTaskDraft("");
    startTransition(async () => {
      const result = await quickCreateTask(title, { companyId: company.id });
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function toggleTask(id: string, completed: boolean) {
    setLocalTasks((prev) => prev.map((t) => (t.id === id ? { ...t, completed_at: completed ? new Date().toISOString() : null } : t)));
    startTransition(async () => {
      await toggleTaskCompleted(id, completed);
    });
  }

  async function onLinkSearch(q: string) {
    setLinkQuery(q);
    setLinkResults(await searchContactsToLink(company.id, q));
  }

  function link(contactId: string | null, id: string) {
    startTransition(async () => {
      const result = await linkContactToCompany(id, contactId);
      if (result.error) setError(result.error);
      else {
        setLinkQuery("");
        setLinkResults([]);
        router.refresh();
      }
    });
  }

  function remove() {
    if (!window.confirm(`Excluir a empresa "${company.name}"? Os contatos continuam, só perdem o vínculo.`)) return;
    startTransition(async () => {
      const result = await deleteCompany(company.id);
      if (result.error) setError(result.error);
      else router.push("/contatos?view=empresas");
    });
  }

  const openTasks = localTasks.filter((t) => !t.completed_at).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/contatos?view=empresas" aria-label="Voltar para empresas" className="grid place-items-center w-9 h-9 rounded-md border border-border text-text-muted hover:text-text shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
          </Link>
          <div className="min-w-0">
            <p className="text-xs text-text-muted">Empresa</p>
            <h1 className="text-2xl font-extrabold tracking-tight truncate">{company.name}</h1>
          </div>
        </div>
        <button type="button" onClick={remove} disabled={pending} className="text-xs font-bold text-danger border border-border rounded-md px-3 py-2 cursor-pointer disabled:opacity-60 shrink-0">
          Excluir empresa
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(300px,380px)_1fr] items-start">
        <div className="flex flex-col gap-5">
          <section className="bg-surface border border-border rounded-lg shadow-sm p-5">
            <h2 className="text-lg font-extrabold mb-2">Empresa</h2>

            <Section title="Cadastro">
              <div className="flex flex-col gap-2.5">
                <Row label="Empresa" required>
                  <input value={form.name} onChange={set("name")} className={input} />
                </Row>
                <Row label="Segmento">
                  <input value={form.industry} onChange={set("industry")} placeholder="Ex.: Varejo, Saúde…" className={input} />
                </Row>
                <Row label="CNPJ">
                  <input value={form.cnpj} onChange={set("cnpj")} placeholder="00.000.000/0000-00" className={input} />
                </Row>
                <Row label="URL">
                  <input value={form.website} onChange={set("website")} placeholder="https://" className={input} />
                </Row>
                <Row label="Domínio">
                  <input value={form.domain} onChange={set("domain")} placeholder="acme.com.br" className={input} />
                </Row>
                <Row label="Telefone">
                  <input value={form.phone} onChange={set("phone")} className={input} />
                </Row>
                <Row label="Endereço">
                  <input value={form.address} onChange={set("address")} placeholder="Rua, número, bairro" className={input} />
                </Row>
                <Row label="Cidade">
                  <input value={form.city} onChange={set("city")} className={input} />
                </Row>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-muted">UF</span>
                    <input value={form.state} onChange={set("state")} maxLength={2} className={`${input} uppercase`} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-text-muted">CEP</span>
                    <input value={form.zip} onChange={set("zip")} className={input} />
                  </label>
                </div>
              </div>
            </Section>

            <Section
              title="Informações adicionais"
              defaultOpen={fields.length > 0}
              action={
                <button
                  type="button"
                  onClick={() => {
                    setFields((f) => [...f, { key: "", value: "" }]);
                    setDirty(true);
                  }}
                  className="text-xs font-bold text-primary-strong hover:underline cursor-pointer shrink-0"
                >
                  + campo
                </button>
              }
            >
              {fields.length === 0 ? (
                <p className="text-xs text-text-muted">Use para guardar qualquer dado extra (porte, número de funcionários, origem…). Clique em &quot;+ campo&quot;.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={f.key}
                        onChange={(e) => {
                          setFields((all) => all.map((r, idx) => (idx === i ? { ...r, key: e.target.value } : r)));
                          setDirty(true);
                        }}
                        placeholder="Nome do campo"
                        className="w-32 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
                      />
                      <input
                        value={f.value}
                        onChange={(e) => {
                          setFields((all) => all.map((r, idx) => (idx === i ? { ...r, value: e.target.value } : r)));
                          setDirty(true);
                        }}
                        placeholder="Valor"
                        className="flex-1 min-w-0 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          setFields((all) => all.filter((_, idx) => idx !== i));
                          setDirty(true);
                        }}
                        aria-label="Remover campo"
                        className="text-danger text-sm font-bold px-1 cursor-pointer"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title={`Observações (${notes.length})`} defaultOpen={notes.length > 0}>
              <div className="flex flex-col gap-2">
                <textarea
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  rows={2}
                  placeholder="Deixe uma anotação sobre essa empresa…"
                  className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y"
                />
                <button type="button" onClick={addNote} disabled={pending || !noteDraft.trim()} className="self-start border border-border text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60">
                  Adicionar observação
                </button>
              </div>
              {notes.length > 0 && (
                <div className="flex flex-col gap-2 mt-3">
                  {notes.map((n) => (
                    <div key={n.id} className="bg-surface-2 border border-border rounded-lg px-3 py-2">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className="text-xs font-bold">{n.author_name || "alguém"}</span>
                        <span className="text-[11px] text-text-muted">{dateTimeBr(n.created_at)}</span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{n.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <div className="flex items-center gap-3 pt-3 border-t border-border">
              <button type="button" onClick={save} disabled={pending || !dirty} className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-50">
                {pending ? "Salvando…" : "Salvar alterações"}
              </button>
              {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
              {error && <span className="text-xs text-danger font-medium">{error}</span>}
            </div>
          </section>

          <section className="bg-surface border border-border rounded-lg shadow-sm p-5">
            <h2 className="text-lg font-extrabold mb-3">Contatos associados ({contacts.length})</h2>
            {contacts.length === 0 ? (
              <p className="text-xs text-text-muted mb-3">Nenhum contato vinculado ainda.</p>
            ) : (
              <div className="flex flex-col gap-1.5 mb-3">
                {contacts.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-2">
                    <Link href={`/crm/${c.id}`} className="flex-1 min-w-0 text-sm font-semibold truncate hover:underline">
                      {c.label}
                      {c.phone && c.label !== c.phone && <span className="font-normal text-text-muted"> · {c.phone}</span>}
                    </Link>
                    <button type="button" onClick={() => link(null, c.id)} disabled={pending} aria-label={`Desvincular ${c.label}`} title="Desvincular da empresa" className="text-danger text-sm font-bold px-1 cursor-pointer">
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <input value={linkQuery} onChange={(e) => onLinkSearch(e.target.value)} placeholder="Vincular contato: busque por nome, telefone ou e-mail" className={input} />
            {linkResults.length > 0 && (
              <div className="mt-1.5 border border-border rounded-md divide-y divide-border">
                {linkResults.map((c) => (
                  <button key={c.id} type="button" onClick={() => link(company.id, c.id)} disabled={pending} className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 cursor-pointer">
                    {c.name || c.phone || c.email}
                    {c.phone && c.name && <span className="text-text-muted"> · {c.phone}</span>}
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <div className="flex gap-6 border-b border-border">
            {(
              [
                ["negociacoes", `Negociações (${leads.length})`],
                ["tarefas", `Tarefas (${openTasks})`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`pb-2.5 text-sm font-bold cursor-pointer border-b-2 -mb-px ${tab === id ? "border-primary text-primary-strong" : "border-transparent text-text-muted hover:text-text"}`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "negociacoes" ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Kpi label="Valor em andamento" value={brl(metrics.open)} tone="info" />
                <Kpi label="Valor total vendido" value={brl(metrics.won)} tone="success" />
                <Kpi label="Valor total perdido" value={brl(metrics.lost)} tone="danger" />
                <Kpi label="Total de negociações" value={String(metrics.total)} tone="plain" />
                <Kpi label="Ticket médio" value={metrics.ticket === null ? "—" : brl(metrics.ticket)} tone="plain" />
                <Kpi label="Tempo médio até a venda" value={metrics.daysToSale === null ? "—" : `${Math.round(metrics.daysToSale)} dia(s)`} tone="plain" />
              </div>

              {leads.length === 0 ? (
                <div className="bg-surface border border-border rounded-lg p-8 text-center text-sm text-text-muted">
                  Nenhuma negociação ainda. Vincule contatos a essa empresa e cada um aparece aqui com seu valor e etapa do pipeline.
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                        <th className="px-4 py-3">Negociação</th>
                        <th className="px-4 py-3">Responsável</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">Valor</th>
                        <th className="px-4 py-3">Criada em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leads.map((l) => (
                        <tr key={l.id} className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
                          <td className="px-4 py-3">
                            <Link href={`/crm/${l.id}`} className="font-semibold text-primary-strong hover:underline">
                              {l.name}
                            </Link>
                            <div className="text-xs text-text-muted">{l.stageLabel}</div>
                          </td>
                          <td className="px-4 py-3 text-text-muted">{l.responsible || "—"}</td>
                          <td className="px-4 py-3">
                            <span className={`text-[11px] font-bold uppercase px-2 py-1 rounded ${STATUS_STYLE[l.status].cls}`}>{STATUS_STYLE[l.status].label}</span>
                          </td>
                          <td className="px-4 py-3 tabular-nums">{brl(l.value)}</td>
                          <td className="px-4 py-3 text-text-muted">{dateBr(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-3">
              {localTasks.length === 0 ? (
                <p className="text-sm text-text-muted">Nenhuma tarefa para essa empresa.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {localTasks.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-2 cursor-pointer">
                      <input type="checkbox" checked={Boolean(t.completed_at)} onChange={(e) => toggleTask(t.id, e.target.checked)} />
                      <span className={`text-sm flex-1 ${t.completed_at ? "line-through text-text-muted" : ""} ${!t.completed_at && isTaskOverdue(t.due_at, t.completed_at) ? "text-danger" : ""}`}>{t.title}</span>
                      {t.due_at && <span className="text-[11px] text-text-muted">{dateTimeBr(t.due_at)}</span>}
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input value={taskDraft} onChange={(e) => setTaskDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTask()} placeholder="título da nova tarefa…" className={input} />
                <button type="button" onClick={addTask} disabled={pending || !taskDraft.trim()} className="border border-border text-xs font-bold px-3 py-2 rounded-md cursor-pointer disabled:opacity-60 shrink-0">
                  + Tarefa
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
