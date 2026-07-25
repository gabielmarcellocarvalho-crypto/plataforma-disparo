"use client";

import { useEffect, useState, useTransition } from "react";
import { getContactDetail, updateContactInfo, addContactNote, type ContactDetail, type ContactNote } from "@/app/actions/contacts";
import { STAGE_LABELS, daysSince, type ContactStage } from "@/lib/crm-stages";

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type FieldRow = { key: string; value: string };

export function CrmLeadDrawer({ contactId, onClose }: { contactId: string | null; onClose: () => void }) {
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

  useEffect(() => {
    if (!contactId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
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
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold truncate">{contact.name || contact.phone || contact.email || "sem nome"}</h2>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  <span className="text-xs font-bold px-2 py-1 rounded-full bg-primary-faint text-primary-strong">
                    {STAGE_LABELS[contact.stage as ContactStage]}
                  </span>
                  <span className="text-xs text-text-muted">há {daysSince(contact.stage_changed_at)}d nessa fase</span>
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
              <div className="text-xs text-text-muted">Entrou em {formatDate(contact.created_at)}</div>

              {(contact.needs_attention || contact.flagged_reason) && (
                <div className={`text-xs font-semibold rounded-lg px-3 py-2.5 ${contact.needs_attention ? "bg-warning-soft text-warning-text" : "bg-info-soft text-info-text"}`}>
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
                    <span className="text-xs font-bold text-text-muted">Campos adicionais (gênero, cidade, etc.)</span>
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
