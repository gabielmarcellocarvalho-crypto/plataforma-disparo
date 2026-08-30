"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { addTask, type ActionResult } from "@/app/actions/tasks";
import { searchCompanies, type CompanyRow } from "@/app/actions/companies";
import { searchWorkspaceContacts, type ContactSearchResult } from "@/app/actions/campaigns";
import { searchDeals, type DealSearchResult } from "@/app/actions/deals";

const INITIAL_STATE: ActionResult = { error: null };

type Responsible = { id: string; name: string };

export function AddTaskForm({ workspaceId, responsibles }: { workspaceId: string; responsibles: Responsible[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(addTask, INITIAL_STATE);

  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ContactSearchResult[]>([]);
  const [contactId, setContactId] = useState("");
  const [contactLabel, setContactLabel] = useState("");

  const [companyQuery, setCompanyQuery] = useState("");
  const [companyOptions, setCompanyOptions] = useState<CompanyRow[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [companyLabel, setCompanyLabel] = useState("");

  const [dealQuery, setDealQuery] = useState("");
  const [dealOptions, setDealOptions] = useState<DealSearchResult[]>([]);
  const [dealId, setDealId] = useState("");
  const [dealLabel, setDealLabel] = useState("");

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  useEffect(() => {
    if (contactQuery.trim().length < 2) {
      setContactOptions([]);
      return;
    }
    const t = setTimeout(() => searchWorkspaceContacts(contactQuery).then(setContactOptions), 250);
    return () => clearTimeout(t);
  }, [contactQuery]);

  useEffect(() => {
    if (companyQuery.trim().length < 2) {
      setCompanyOptions([]);
      return;
    }
    const t = setTimeout(() => searchCompanies(workspaceId, companyQuery).then(setCompanyOptions), 250);
    return () => clearTimeout(t);
  }, [companyQuery, workspaceId]);

  useEffect(() => {
    if (dealQuery.trim().length < 2) {
      setDealOptions([]);
      return;
    }
    const t = setTimeout(() => searchDeals(workspaceId, dealQuery).then(setDealOptions), 250);
    return () => clearTimeout(t);
  }, [dealQuery, workspaceId]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        + Tarefa
      </button>

      <dialog ref={dialogRef} className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-sm">
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Adicionar tarefa</h2>

          <input type="hidden" name="contactId" value={contactId} />
          <input type="hidden" name="companyId" value={companyId} />
          <input type="hidden" name="dealId" value={dealId} />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="title" className="text-sm font-semibold">Título</label>
            <input id="title" name="title" required className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="dueAt" className="text-sm font-semibold">Data de vencimento</label>
            <input id="dueAt" name="dueAt" type="date" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          {responsibles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="responsibleUserId" className="text-sm font-semibold">Responsável</label>
              <select id="responsibleUserId" name="responsibleUserId" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary bg-surface cursor-pointer">
                <option value="">sem responsável</option>
                {responsibles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">Contato (opcional)</label>
            <input
              value={contactQuery || contactLabel}
              onChange={(e) => { setContactQuery(e.target.value); setContactLabel(""); setContactId(""); }}
              placeholder="buscar contato…"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            {contactOptions.length > 0 && (
              <div className="flex flex-col border border-border rounded-md overflow-hidden">
                {contactOptions.map((c) => (
                  <button type="button" key={c.id} onClick={() => { setContactId(c.id); setContactLabel(c.name || c.phone || c.email || "contato"); setContactQuery(""); setContactOptions([]); }} className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer">
                    {c.name || c.phone || c.email}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">Empresa (opcional)</label>
            <input
              value={companyQuery || companyLabel}
              onChange={(e) => { setCompanyQuery(e.target.value); setCompanyLabel(""); setCompanyId(""); }}
              placeholder="buscar empresa…"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            {companyOptions.length > 0 && (
              <div className="flex flex-col border border-border rounded-md overflow-hidden">
                {companyOptions.map((c) => (
                  <button type="button" key={c.id} onClick={() => { setCompanyId(c.id); setCompanyLabel(c.name); setCompanyQuery(""); setCompanyOptions([]); }} className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer">
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold">Negócio (opcional)</label>
            <input
              value={dealQuery || dealLabel}
              onChange={(e) => { setDealQuery(e.target.value); setDealLabel(""); setDealId(""); }}
              placeholder="buscar negócio…"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            {dealOptions.length > 0 && (
              <div className="flex flex-col border border-border rounded-md overflow-hidden">
                {dealOptions.map((d) => (
                  <button type="button" key={d.id} onClick={() => { setDealId(d.id); setDealLabel(d.name); setDealQuery(""); setDealOptions([]); }} className="text-left text-xs px-2.5 py-1.5 hover:bg-surface-2 cursor-pointer">
                    {d.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm font-semibold text-text-muted px-4 py-2.5 cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60 cursor-pointer">
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
