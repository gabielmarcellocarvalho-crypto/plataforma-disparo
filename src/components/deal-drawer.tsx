"use client";

import { useEffect, useState, useTransition } from "react";
import { getDealDetail, updateDealInfo, updateDealStage, addDealNote, type DealDetail, type DealNote } from "@/app/actions/deals";
import { searchCompanies, type CompanyRow } from "@/app/actions/companies";
import { searchWorkspaceContacts, type ContactSearchResult } from "@/app/actions/campaigns";
import type { DealStage } from "@/lib/deal-stages";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

type FieldRow = { key: string; value: string };
type Responsible = { id: string; name: string };

export function DealDrawer({
  dealId,
  onClose,
  stages,
  workspaceId,
  responsibles,
}: {
  dealId: string | null;
  onClose: () => void;
  stages: DealStage[];
  workspaceId: string;
  responsibles: Responsible[];
}) {
  const [deal, setDeal] = useState<DealDetail | null>(null);
  const [notes, setNotes] = useState<DealNote[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [closeDate, setCloseDate] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");
  const [contactId, setContactId] = useState("");
  const [contactLabel, setContactLabel] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [fields, setFields] = useState<FieldRow[]>([]);
  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<CompanyRow[]>([]);
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactSearchResult[]>([]);
  const [noteDraft, setNoteDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dealId) return;
    setLoading(true);
    setError(null);
    setSaved(false);
    getDealDetail(dealId).then((result) => {
      if (!result) {
        setError("Negócio não encontrado.");
        setLoading(false);
        return;
      }
      setDeal(result.deal);
      setNotes(result.notes);
      setName(result.deal.name);
      setAmount(result.deal.amount !== null ? String(result.deal.amount) : "");
      setCloseDate(result.deal.close_date || "");
      setCompanyId(result.deal.company_id || "");
      setContactId(result.deal.contact_id || "");
      setResponsibleId(result.deal.responsible_user_id || "");
      setFields(Object.entries(result.deal.custom_fields || {}).map(([key, value]) => ({ key, value: String(value) })));
      setLoading(false);
    });
  }, [dealId]);

  useEffect(() => {
    if (companyQuery.trim().length < 2) {
      setCompanyOptions([]);
      return;
    }
    const t = setTimeout(() => {
      searchCompanies(workspaceId, companyQuery).then(setCompanyOptions);
    }, 250);
    return () => clearTimeout(t);
  }, [companyQuery, workspaceId]);

  useEffect(() => {
    if (contactQuery.trim().length < 2) {
      setContactOptions([]);
      return;
    }
    const t = setTimeout(() => {
      searchWorkspaceContacts(contactQuery).then(setContactOptions);
    }, 250);
    return () => clearTimeout(t);
  }, [contactQuery]);

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
    if (!dealId) return;
    setError(null);
    setSaved(false);
    const customFields = Object.fromEntries(fields.filter((f) => f.key.trim()).map((f) => [f.key.trim(), f.value.trim()]));
    startTransition(async () => {
      const result = await updateDealInfo(dealId, {
        name,
        amount,
        closeDate,
        companyId,
        contactId,
        responsibleUserId: responsibleId,
        customFields,
      });
      if (result.error) setError(result.error);
      else setSaved(true);
    });
  }

  function handleStageChange(stageId: string) {
    if (!dealId || !deal) return;
    setDeal({ ...deal, stage_id: stageId });
    startTransition(async () => {
      const result = await updateDealStage(dealId, stageId);
      if (result.error) setError(result.error);
    });
  }

  function handleAddNote() {
    if (!dealId || !noteDraft.trim()) return;
    const content = noteDraft;
    setNoteDraft("");
    startTransition(async () => {
      const result = await addDealNote(dealId, content);
      if (result.error) setError(result.error);
      else {
        const refreshed = await getDealDetail(dealId);
        if (refreshed) setNotes(refreshed.notes);
      }
    });
  }

  const open = Boolean(dealId);

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
        aria-label="Detalhe do negócio"
      >
        {loading || !deal ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">{open ? "Carregando…" : ""}</div>
        ) : (
          <>
            <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-border shrink-0">
              <div className="min-w-0">
                <h2 className="text-lg font-extrabold truncate">{deal.name}</h2>
                <select
                  value={deal.stage_id}
                  onChange={(e) => handleStageChange(e.target.value)}
                  className="text-xs font-bold px-2 py-1 mt-1.5 rounded-full bg-primary-faint text-primary-strong border-none outline-none cursor-pointer"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
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
                <h3 className="text-sm font-bold">Infos do negócio</h3>
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Nome</label>
                    <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Valor (R$)</label>
                    <input value={amount} onChange={(e) => { setAmount(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Fechamento previsto</label>
                    <input type="date" value={closeDate} onChange={(e) => { setCloseDate(e.target.value); setSaved(false); }} className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary" />
                  </div>

                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Empresa</label>
                    <input
                      value={companyQuery || companyLabel}
                      onChange={(e) => { setCompanyQuery(e.target.value); setCompanyLabel(""); }}
                      placeholder={companyId ? "empresa vinculada — digite pra trocar" : "buscar empresa…"}
                      className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary"
                    />
                    {companyOptions.length > 0 && (
                      <div className="flex flex-col border border-border rounded-md overflow-hidden mt-1">
                        {companyOptions.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => { setCompanyId(c.id); setCompanyLabel(c.name); setCompanyQuery(""); setCompanyOptions([]); setSaved(false); }}
                            className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer"
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {companyId && !companyQuery && (
                      <button type="button" onClick={() => { setCompanyId(""); setCompanyLabel(""); }} className="text-[11px] text-danger self-start mt-0.5 cursor-pointer">
                        remover vínculo
                      </button>
                    )}
                  </div>

                  <div className="col-span-2 flex flex-col gap-1">
                    <label className="text-xs font-semibold text-text-muted">Contato</label>
                    <input
                      value={contactQuery || contactLabel}
                      onChange={(e) => { setContactQuery(e.target.value); setContactLabel(""); }}
                      placeholder={contactId ? "contato vinculado — digite pra trocar" : "buscar contato…"}
                      className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary"
                    />
                    {contactOptions.length > 0 && (
                      <div className="flex flex-col border border-border rounded-md overflow-hidden mt-1">
                        {contactOptions.map((c) => (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => { setContactId(c.id); setContactLabel(c.name || c.phone || c.email || "contato"); setContactQuery(""); setContactOptions([]); setSaved(false); }}
                            className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer"
                          >
                            {c.name || c.phone || c.email}
                          </button>
                        ))}
                      </div>
                    )}
                    {contactId && !contactQuery && (
                      <button type="button" onClick={() => { setContactId(""); setContactLabel(""); }} className="text-[11px] text-danger self-start mt-0.5 cursor-pointer">
                        remover vínculo
                      </button>
                    )}
                  </div>

                  {responsibles.length > 0 && (
                    <div className="col-span-2 flex flex-col gap-1">
                      <label className="text-xs font-semibold text-text-muted">Responsável</label>
                      <select
                        value={responsibleId}
                        onChange={(e) => { setResponsibleId(e.target.value); setSaved(false); }}
                        className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface cursor-pointer"
                      >
                        <option value="">sem responsável</option>
                        {responsibles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
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

              <div className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-bold">Observações da equipe</h3>
                <div className="flex flex-col gap-2">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value)}
                    rows={2}
                    placeholder="Deixe uma anotação sobre esse negócio…"
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
