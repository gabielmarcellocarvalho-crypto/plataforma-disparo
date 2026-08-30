"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { getContactDetail, updateContactInfo, updateContactStage, addContactNote, type ContactDetail, type ContactNote } from "@/app/actions/contacts";
import { daysSince, STAGE_ORDER, type ContactStage } from "@/lib/crm-stages";
import { linkContactToCompany, createCompanyAndLinkContact, searchCompanies, type CompanyRow } from "@/app/actions/companies";
import { getDealsForContact, quickCreateDealForContact, type ContactDealRef } from "@/app/actions/deals";
import { formatDealAmount } from "@/lib/deal-stages";
import { getTasksForRecord, quickCreateTask, toggleTaskCompleted, type TaskRow } from "@/app/actions/tasks";
import { isTaskOverdue } from "@/lib/tasks";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type FieldRow = { key: string; value: string };

export function CrmLeadDrawer({
  contactId,
  onClose,
  stageLabels,
  workspaceId,
}: {
  contactId: string | null;
  onClose: () => void;
  stageLabels: Record<ContactStage, string>;
  workspaceId?: string;
}) {
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [deals, setDeals] = useState<ContactDealRef[]>([]);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<CompanyRow[]>([]);
  const [dealNameDraft, setDealNameDraft] = useState("");
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [taskTitleDraft, setTaskTitleDraft] = useState("");

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    setCompanyQuery("");
    setCompanyOptions([]);
    setDealNameDraft("");
    setTaskTitleDraft("");
    getDealsForContact(contactId).then(setDeals);
    getTasksForRecord("contact", contactId).then(setTasks);
    getContactDetail(contactId).then((result) => {
      if (!result) {
        setError("Contato não encontrado.");
        setLoading(false);
        return;
      }
      setContact(result.contact);
      setNotes(result.notes);
      setName(result.contact.name || "");
      setPhone(result.contact.phone || "");
      setEmail(result.contact.email || "");
      setFields(Object.entries(result.contact.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) })));
      setLoading(false);
    });
  }, [contactId]);

  function addField() {
    setFields((f) => [...f, { key: "", value: "" }]);
  }
  function updateField(i: number, patch: Partial<FieldRow>) {
    setFields((f) => f.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
    setSaved(false);
  }
  function removeField(i: number) {
    setFields((f) => f.filter((_, idx) => idx !== i));
    setSaved(false);
  }

  function handleSave() {
    if (!contactId) return;
    setError(null);
    setSaved(false);
    const customFields = Object.fromEntries(fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value.trim()]));
    startTransition(async () => {
      const result = await updateContactInfo(contactId, { name, phone, email, customFields });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  function handleStageChange(stage: ContactStage) {
    if (!contactId || !contact) return;
    setContact({ ...contact, stage });
    startTransition(async () => {
      const result = await updateContactStage(contactId, stage);
      if (result.error) setError(result.error);
    });
  }

  function handleAddNote() {
    if (!contactId || !noteDraft.trim()) return;
    const content = noteDraft;
    setNoteDraft("");
    startTransition(async () => {
      const result = await addContactNote(contactId, content);
      if (result.error) setError(result.error);
      else {
        const refreshed = await getContactDetail(contactId);
        if (refreshed) setNotes(refreshed.notes);
      }
    });
  }

  useEffect(() => {
    if (!workspaceId || companyQuery.trim().length < 2) {
      setCompanyOptions([]);
      return;
    }
    const t = setTimeout(() => {
      searchCompanies(workspaceId, companyQuery).then(setCompanyOptions);
    }, 250);
    return () => clearTimeout(t);
  }, [companyQuery, workspaceId]);

  function handleLinkCompany(companyId: string, companyName: string) {
    if (!contactId || !contact) return;
    setContact({ ...contact, company_id: companyId, company_name: companyName });
    setCompanyQuery("");
    setCompanyOptions([]);
    startTransition(async () => {
      const result = await linkContactToCompany(contactId, companyId);
      if (result.error) setError(result.error);
    });
  }

  function handleUnlinkCompany() {
    if (!contactId || !contact) return;
    setContact({ ...contact, company_id: null, company_name: null });
    startTransition(async () => {
      const result = await linkContactToCompany(contactId, null);
      if (result.error) setError(result.error);
    });
  }

  function handleCreateCompany() {
    if (!contactId || !companyQuery.trim()) return;
    const companyName = companyQuery.trim();
    setCompanyQuery("");
    setCompanyOptions([]);
    startTransition(async () => {
      const result = await createCompanyAndLinkContact(contactId, companyName);
      if (result.error) setError(result.error);
      else setContact((c) => (c ? { ...c, company_id: result.companyId || null, company_name: companyName } : c));
    });
  }

  function handleQuickCreateDeal() {
    if (!contactId || !dealNameDraft.trim()) return;
    const dealName = dealNameDraft.trim();
    setDealNameDraft("");
    startTransition(async () => {
      const result = await quickCreateDealForContact(contactId, dealName);
      if (result.error) setError(result.error);
      else {
        const refreshed = await getDealsForContact(contactId);
        setDeals(refreshed);
      }
    });
  }

  function handleQuickCreateTask() {
    if (!contactId || !taskTitleDraft.trim()) return;
    const title = taskTitleDraft.trim();
    setTaskTitleDraft("");
    startTransition(async () => {
      const result = await quickCreateTask(title, { contactId });
      if (result.error) setError(result.error);
      else {
        const refreshed = await getTasksForRecord("contact", contactId);
        setTasks(refreshed);
      }
    });
  }

  function handleToggleTask(taskId: string, completed: boolean) {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, completed_at: completed ? new Date().toISOString() : null } : t)));
    startTransition(async () => {
      await toggleTaskCompleted(taskId, completed);
    });
  }

  const open = Boolean(contactId);

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        aria-hidden
      />
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-md bg-surface z-50 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-label="Detalhe do lead"
      >
        {loading || !contact ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">{open ? "Carregando…" : ""}</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                {contact.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={contact.photo_url} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" aria-hidden />
                ) : (
                  <span className="grid place-items-center w-12 h-12 rounded-full bg-primary-soft text-primary-strong text-sm font-bold shrink-0" aria-hidden>
                    {(contact.name || contact.phone || "?").trim().slice(0, 2).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <h2 className="text-lg font-extrabold truncate">{contact.name || contact.phone || contact.email || "sem nome"}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <select
                    value={contact.stage}
                    onChange={(e) => handleStageChange(e.target.value as ContactStage)}
                    className="text-xs font-bold px-2 py-1 rounded-full bg-primary-faint text-primary-strong border-none outline-none cursor-pointer"
                  >
                    {STAGE_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {stageLabels[s]}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-text-muted">há {daysSince(contact.stage_changed_at)}d nessa fase</span>
                </div>
                </div>
              </div>
              <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-xs text-text-muted">Entrou em {formatDate(contact.created_at)}</span>
                  <span className="text-xs text-text-muted">{contact.message_count} mensage{contact.message_count === 1 ? "m" : "ns"}</span>
                </div>
                {contact.stage !== "nao_abordado" && (
                  <Link
                    href={`/conversas?contact=${contact.id}`}
                    className="text-xs font-bold text-primary-strong hover:underline flex items-center gap-1"
                  >
                    Ver conversa
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </Link>
                )}
              </div>

              {(contact.needs_attention || contact.flagged_reason) && (
                <div
                  className={`text-xs font-semibold rounded-lg px-3 py-2.5 ${
                    contact.needs_attention ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning-text"
                  }`}
                >
                  {contact.needs_attention ? contact.attention_reason || "Precisa de atenção humana." : contact.flagged_reason}
                </div>
              )}

              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold">Infos pessoais</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Nome</label>
                    <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Telefone</label>
                    <input value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">E-mail</label>
                    <input value={email} onChange={(e) => { setEmail(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-muted">Campos adicionais (dores, gênero, cidade, etc.)</span>
                    <button type="button" onClick={addField} className="text-xs font-bold text-primary-strong hover:underline cursor-pointer">
                      + campo
                    </button>
                  </div>
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={f.key}
                        onChange={(e) => updateField(i, { key: e.target.value })}
                        placeholder="chave (ex: cidade)"
                        className="w-28 border border-border rounded-md px-2 py-1.5 text-xs font-mono outline-none focus:border-primary"
                      />
                      <input
                        value={f.value}
                        onChange={(e) => updateField(i, { value: e.target.value })}
                        placeholder="valor"
                        className="flex-1 border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
                      />
                      <button type="button" onClick={() => removeField(i)} aria-label="Remover campo" className="text-danger text-xs font-bold px-1 cursor-pointer">
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={pending}
                    className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
                  >
                    Salvar
                  </button>
                  {saved && <span className="text-xs font-semibold text-success">Salvo.</span>}
                  {error && <span className="text-xs text-danger font-medium">{error}</span>}
                </div>
              </div>

              {workspaceId && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <h3 className="text-sm font-bold">Empresa</h3>
                  {contact.company_id ? (
                    <div className="flex items-center justify-between gap-2 bg-surface-2 border border-border rounded-md px-3 py-2">
                      <Link href="/empresas" className="text-sm font-semibold hover:text-primary-strong hover:underline">
                        {contact.company_name || "empresa vinculada"}
                      </Link>
                      <button type="button" onClick={handleUnlinkCompany} className="text-xs text-danger font-bold cursor-pointer">
                        desvincular
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      <input
                        value={companyQuery}
                        onChange={(e) => setCompanyQuery(e.target.value)}
                        placeholder="buscar empresa ou digitar nome nova…"
                        className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary"
                      />
                      {companyOptions.length > 0 && (
                        <div className="flex flex-col border border-border rounded-md overflow-hidden">
                          {companyOptions.map((c) => (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => handleLinkCompany(c.id, c.name)}
                              className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer"
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                      {companyQuery.trim() && companyOptions.length === 0 && (
                        <button type="button" onClick={handleCreateCompany} className="text-xs font-bold text-primary-strong hover:underline cursor-pointer self-start">
                          + criar empresa &quot;{companyQuery.trim()}&quot;
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">Negócios ({deals.length})</h3>
                </div>
                {deals.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {deals.map((d) => (
                      <Link
                        key={d.id}
                        href="/negocios"
                        className="text-sm bg-surface-2 border border-border rounded-md px-3 py-2 flex items-center justify-between hover:border-primary-soft"
                      >
                        <span>{d.name}</span>
                        <span className="text-xs font-mono text-text-muted">{formatDealAmount(d.amount)}</span>
                      </Link>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={dealNameDraft}
                    onChange={(e) => setDealNameDraft(e.target.value)}
                    placeholder="nome do novo negócio…"
                    className="flex-1 border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={handleQuickCreateDeal}
                    disabled={pending || !dealNameDraft.trim()}
                    className="border border-border text-xs font-bold px-3 py-2 rounded-md cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    + Negócio
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Tarefas ({tasks.filter((t) => !t.completed_at).length})</h3>
                {tasks.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {tasks.map((t) => (
                      <label key={t.id} className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-2 cursor-pointer">
                        <input type="checkbox" checked={Boolean(t.completed_at)} onChange={(e) => handleToggleTask(t.id, e.target.checked)} />
                        <span className={`text-sm flex-1 ${t.completed_at ? "line-through text-text-muted" : ""} ${!t.completed_at && isTaskOverdue(t.due_at, t.completed_at) ? "text-danger" : ""}`}>
                          {t.title}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    value={taskTitleDraft}
                    onChange={(e) => setTaskTitleDraft(e.target.value)}
                    placeholder="título da nova tarefa…"
                    className="flex-1 border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={handleQuickCreateTask}
                    disabled={pending || !taskTitleDraft.trim()}
                    className="border border-border text-xs font-bold px-3 py-2 rounded-md cursor-pointer disabled:opacity-60 shrink-0"
                  >
                    + Tarefa
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Observações da equipe</h3>
                <div className="flex flex-col gap-2">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="Deixe uma anotação sobre esse lead…"
                    className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y"
                  />
                  <button
                    type="button"
                    onClick={handleAddNote}
                    disabled={pending || !noteDraft.trim()}
                    className="self-start border border-border text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
                  >
                    Adicionar observação
                  </button>
                </div>

                {notes.length === 0 ? (
                  <p className="text-xs text-text-muted">Nenhuma observação ainda.</p>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {notes.map((n) => (
                      <div key={n.id} className="bg-surface-2 border border-border rounded-lg px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="text-xs font-bold">{n.author_name || "alguém"}</span>
                          <span className="text-[11px] text-text-muted">{formatDateTime(n.created_at)}</span>
                        </div>
                        <p className="text-sm text-text whitespace-pre-wrap">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
