"use client";

import { useEffect, useState, useTransition } from "react";
import { activateCampaign, pauseCampaign, searchWorkspaceContacts, type ContactSearchResult } from "@/app/actions/campaigns";

export type StageOption = { value: string; label: string };
export type TagOption = { tag: string; count: number };

type SendMode = "todos" | "limite" | "contato";

export function CampaignRowActions({
  id,
  status,
  stages,
  tags = [],
}: {
  id: string;
  status: string;
  stages: StageOption[];
  tags?: TagOption[];
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [selectedStages, setSelectedStages] = useState<Set<string>>(new Set());
  const [sinceDays, setSinceDays] = useState("");
  // Segmentação por tag: incluir = tem alguma dessas; excluir = não tem nenhuma dessas (é como se
  // evita remandar pra quem já recebeu a etapa anterior).
  const [tagsInclude, setTagsInclude] = useState<Set<string>>(new Set());
  const [tagsExclude, setTagsExclude] = useState<Set<string>>(new Set());

  const [sendMode, setSendMode] = useState<SendMode>("todos");
  const [limit, setLimit] = useState("");
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<ContactSearchResult[]>([]);
  const [selectedContact, setSelectedContact] = useState<ContactSearchResult | null>(null);
  const [searching, startSearching] = useTransition();

  useEffect(() => {
    if (sendMode !== "contato" || selectedContact || contactQuery.trim().length < 2) {
      setContactResults([]);
      return;
    }
    const handle = setTimeout(() => {
      startSearching(async () => setContactResults(await searchWorkspaceContacts(contactQuery)));
    }, 300);
    return () => clearTimeout(handle);
  }, [contactQuery, sendMode, selectedContact]);

  if (status === "ativa") {
    return (
      <button
        onClick={() => startTransition(() => pauseCampaign(id))}
        disabled={pending}
        className="text-xs font-bold text-text-muted hover:text-text disabled:opacity-60"
      >
        Pausar
      </button>
    );
  }

  function toggleStage(value: string) {
    setSelectedStages((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  // Uma tag nunca fica marcada nos dois lados ao mesmo tempo — "incluir e excluir Associado" não
  // devolveria ninguém, e o usuário só descobriria isso no erro de "nenhum contato encontrado".
  function toggleTag(tag: string, lado: "include" | "exclude") {
    const [alvo, setAlvo, oposto, setOposto] =
      lado === "include"
        ? ([tagsInclude, setTagsInclude, tagsExclude, setTagsExclude] as const)
        : ([tagsExclude, setTagsExclude, tagsInclude, setTagsInclude] as const);
    const next = new Set(alvo);
    if (next.has(tag)) next.delete(tag);
    else {
      next.add(tag);
      if (oposto.has(tag)) {
        const limpo = new Set(oposto);
        limpo.delete(tag);
        setOposto(limpo);
      }
    }
    setAlvo(next);
  }

  function handleConfirm() {
    setError(null);
    if (sendMode === "contato" && !selectedContact) {
      setError("Escolha um contato pra testar.");
      return;
    }
    startTransition(async () => {
      const result = await activateCampaign(id, {
        stages: Array.from(selectedStages),
        tagsInclude: Array.from(tagsInclude),
        tagsExclude: Array.from(tagsExclude),
        sinceDays: sinceDays.trim() ? Number(sinceDays) : null,
        contactId: sendMode === "contato" ? selectedContact!.id : null,
        limit: sendMode === "limite" && limit.trim() ? Number(limit) : null,
      });
      setError(result.error);
      if (!result.error) setOptionsOpen(false);
    });
  }

  if (!optionsOpen) {
    return (
      <button
        type="button"
        onClick={() => setOptionsOpen(true)}
        className="text-xs font-bold text-primary-strong hover:underline cursor-pointer"
      >
        Ativar disparo
      </button>
    );
  }

  const filtersDisabled = sendMode === "contato";

  return (
    <div className="flex flex-col items-end gap-2 text-left bg-surface-2 border border-border rounded-lg p-3 w-80">
      <div className="w-full">
        <span className="text-xs font-semibold block mb-1.5">Enviar para</span>
        <div className="flex gap-1.5">
          {([
            { key: "todos", label: "Todos" },
            { key: "limite", label: "Limitar qtd." },
            { key: "contato", label: "1 contato (teste)" },
          ] as { key: SendMode; label: string }[]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setSendMode(opt.key)}
              className={`flex-1 text-[11px] font-bold px-2 py-1.5 rounded-md border cursor-pointer ${
                sendMode === opt.key ? "bg-primary-strong text-white border-primary-strong" : "border-border text-text-muted"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {sendMode === "limite" && (
        <label className="flex items-center gap-2 text-xs font-semibold w-full">
          Enviar só pros primeiros
          <input
            type="number"
            min={1}
            value={limit}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="10"
            className="w-16 border border-border rounded-md px-1.5 py-1 text-xs outline-none focus:border-primary"
          />
          contatos do filtro abaixo
        </label>
      )}

      {sendMode === "contato" && (
        <div className="w-full flex flex-col gap-1.5">
          <span className="text-xs font-semibold">Contato pra testar</span>
          {selectedContact ? (
            <div className="flex items-center justify-between gap-2 bg-primary-faint border border-primary rounded-md px-2 py-1.5">
              <span className="text-xs font-semibold truncate">
                {selectedContact.name || "sem nome"} — {selectedContact.phone || selectedContact.email}
              </span>
              <button
                type="button"
                onClick={() => {
                  setSelectedContact(null);
                  setContactQuery("");
                }}
                className="text-[11px] font-bold text-primary-strong hover:underline shrink-0 cursor-pointer"
              >
                Trocar
              </button>
            </div>
          ) : (
            <>
              <input
                value={contactQuery}
                onChange={(e) => setContactQuery(e.target.value)}
                placeholder="Nome, telefone ou e-mail"
                className="border border-border rounded-md px-2 py-1.5 text-xs outline-none focus:border-primary"
              />
              {searching && <p className="text-[11px] text-text-muted">Buscando…</p>}
              {contactResults.length > 0 && (
                <div className="flex flex-col gap-0.5 max-h-32 overflow-y-auto border border-border rounded-md">
                  {contactResults.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedContact(c)}
                      className="text-left text-xs px-2 py-1.5 hover:bg-bg cursor-pointer border-b border-border last:border-0"
                    >
                      <span className="font-semibold">{c.name || "sem nome"}</span> — {c.phone || c.email}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tags.length > 0 && (
        <div className={`w-full ${filtersDisabled ? "opacity-40 pointer-events-none" : ""}`}>
          <span className="text-xs font-semibold block mb-1.5">Grupos (tags)</span>
          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
            {tags.map((t) => (
              <div key={t.tag} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" title={t.tag}>
                  {t.tag} <span className="text-text-muted">({t.count})</span>
                </span>
                <div className="flex gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleTag(t.tag, "include")}
                    aria-pressed={tagsInclude.has(t.tag)}
                    title="Mandar só pra quem tem essa tag"
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-pointer ${
                      tagsInclude.has(t.tag) ? "bg-success-soft border-success text-success" : "border-border text-text-muted"
                    }`}
                  >
                    incluir
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleTag(t.tag, "exclude")}
                    aria-pressed={tagsExclude.has(t.tag)}
                    title="Não mandar pra quem tem essa tag"
                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded border cursor-pointer ${
                      tagsExclude.has(t.tag) ? "bg-danger-soft border-danger text-danger" : "border-border text-text-muted"
                    }`}
                  >
                    excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-text-muted mt-1">
            Incluir = tem alguma das marcadas. Excluir = não tem nenhuma das marcadas. Nada marcado = base inteira.
          </p>
        </div>
      )}

      <div className={`w-full ${filtersDisabled ? "opacity-40 pointer-events-none" : ""}`}>
        <span className="text-xs font-semibold block mb-1.5">Fases do CRM (nenhuma marcada = todas)</span>
        {stages.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma fase visível no CRM desse workspace.</p>
        ) : (
          <div className="flex flex-col gap-1 max-h-36 overflow-y-auto">
            {stages.map((s) => (
              <label key={s.value} className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={selectedStages.has(s.value)} onChange={() => toggleStage(s.value)} />
                {s.label}
              </label>
            ))}
          </div>
        )}
      </div>
      <label className={`flex items-center gap-2 text-xs font-semibold w-full ${filtersDisabled ? "opacity-40 pointer-events-none" : ""}`}>
        Só quem mudou de fase nos últimos
        <input
          type="number"
          min={1}
          value={sinceDays}
          onChange={(e) => setSinceDays(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder="90"
          className="w-14 border border-border rounded-md px-1.5 py-1 text-xs outline-none focus:border-primary"
        />
        dias
      </label>
      <div className="flex items-center gap-2 w-full justify-end pt-1">
        <button type="button" onClick={() => setOptionsOpen(false)} disabled={pending} className="text-xs font-semibold text-text-muted cursor-pointer disabled:opacity-60">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="bg-primary-strong text-white text-xs font-bold px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
        >
          {pending ? "Ativando…" : "Confirmar ativação"}
        </button>
      </div>
      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
}
