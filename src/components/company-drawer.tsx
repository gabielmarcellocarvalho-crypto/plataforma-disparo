"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  getCompanyDetail,
  updateCompanyInfo,
  addCompanyNote,
  type CompanyDetail,
  type CompanyNote,
  type CompanyContactRef,
  type CompanyDealRef,
} from "@/app/actions/companies";
import { formatDealAmount } from "@/lib/deal-stages";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type FieldRow = { key: string; value: string };

export function CompanyDrawer({ companyId, onClose }: { companyId: string | null; onClose: () => void }) {
  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [notes, setNotes] = useState<CompanyNote[]>([]);
  const [contacts, setContacts] = useState<CompanyContactRef[]>([]);
  const [deals, setDeals] = useState<CompanyDealRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [industry, setIndustry] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!companyId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getCompanyDetail(companyId).then((result) => {
      if (!result) {
        setError("Empresa não encontrada.");
        setLoading(false);
        return;
      }
      setCompany(result.company);
      setNotes(result.notes);
      setContacts(result.contacts);
      setDeals(result.deals);
      setName(result.company.name || "");
      setDomain(result.company.domain || "");
      setWebsite(result.company.website || "");
      setPhone(result.company.phone || "");
      setIndustry(result.company.industry || "");
      setFields(Object.entries(result.company.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) })));
      setLoading(false);
    });
  }, [companyId]);

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
    if (!companyId) return;
    setError(null);
    setSaved(false);
    const customFields = Object.fromEntries(fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value.trim()]));
    startTransition(async () => {
      const result = await updateCompanyInfo(companyId, { name, domain, website, phone, industry, customFields });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  function handleAddNote() {
    if (!companyId || !noteDraft.trim()) return;
    const content = noteDraft;
    setNoteDraft("");
    startTransition(async () => {
      const result = await addCompanyNote(companyId, content);
      if (result.error) setError(result.error);
      else {
        const refreshed = await getCompanyDetail(companyId);
        if (refreshed) setNotes(refreshed.notes);
      }
    });
  }

  const open = Boolean(companyId);

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
        aria-label="Detalhe da empresa"
      >
        {loading || !company ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">{open ? "Carregando…" : ""}</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold truncate">{company.name}</h2>
                {company.domain && <span className="text-xs text-text-muted">{company.domain}</span>}
              </div>
              <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 flex flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h3 className="text-sm font-bold">Infos da empresa</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Nome</label>
                    <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Domínio</label>
                    <input value={domain} onChange={(e) => { setDomain(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Site</label>
                    <input value={website} onChange={(e) => { setWebsite(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Telefone</label>
                    <input value={phone} onChange={(e) => { setPhone(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Indústria</label>
                    <input value={industry} onChange={(e) => { setIndustry(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                </div>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-muted">Campos adicionais</span>
                    <button type="button" onClick={addField} className="text-xs font-bold text-primary-strong hover:underline cursor-pointer">
                      + campo
                    </button>
                  </div>
                  {fields.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={f.key}
                        onChange={(e) => updateField(i, { key: e.target.value })}
                        placeholder="chave"
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

              <div className="flex flex-col gap-2.5 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Contatos ({contacts.length})</h3>
                {contacts.length === 0 ? (
                  <p className="text-xs text-text-muted">Nenhum contato vinculado ainda.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {contacts.map((c) => (
                      <div key={c.id} className="text-sm bg-surface-2 border border-border rounded-md px-3 py-2">
                        {c.name || c.phone || c.email || "sem nome"}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2.5 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Negócios ({deals.length})</h3>
                {deals.length === 0 ? (
                  <p className="text-xs text-text-muted">Nenhum negócio vinculado ainda.</p>
                ) : (
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
              </div>

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Observações da equipe</h3>
                <div className="flex flex-col gap-2">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="Deixe uma anotação sobre essa empresa…"
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
