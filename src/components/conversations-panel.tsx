"use client";

import { useMemo, useState, useTransition } from "react";
import { takeOverConversation, resolveAttention, sendManualMessage } from "@/app/actions/conversations";

type Contact = { id: string; name: string | null; phone: string | null; needs_attention: boolean; attention_reason: string | null };
type Agent = { id: string; name: string; photo_url: string | null; evolution_instance_name: string };
type Message = { id: string; contact_id: string; agent_id: string | null; role: string; content: string; created_at: string };

export type Conversation = { contact: Contact; agent: Agent; messages: Message[] };

function initials(name: string | null, phone: string | null) {
  const source = (name || phone || "?").trim();
  return source.slice(0, 2).toUpperCase();
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ConversationsPanel({ conversations }: { conversations: Conversation[] }) {
  const [query, setQuery] = useState("");
  const [selectedKey, setSelectedKey] = useState<string | null>(conversations[0] ? keyOf(conversations[0]) : null);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter(
      (c) => (c.contact.name || "").toLowerCase().includes(q) || (c.contact.phone || "").includes(q)
    );
  }, [conversations, query]);

  const selected = conversations.find((c) => keyOf(c) === selectedKey) || null;
  const orderedMessages = selected ? [...selected.messages].reverse() : [];

  function handleTakeOver(contactId: string) {
    setError(null);
    startTransition(async () => {
      const result = await takeOverConversation(contactId);
      if (result.error) setError(result.error);
    });
  }

  function handleResolve(contactId: string) {
    setError(null);
    startTransition(async () => {
      const result = await resolveAttention(contactId);
      if (result.error) setError(result.error);
    });
  }

  function handleSend() {
    if (!selected || !draft.trim()) return;
    setError(null);
    const text = draft;
    startTransition(async () => {
      const result = await sendManualMessage(selected.contact.id, selected.agent.id, text);
      if (result.error) setError(result.error);
      else setDraft("");
    });
  }

  return (
    <div className="flex-1 min-h-0 grid grid-cols-[320px_1fr] bg-surface border border-border rounded-lg shadow-sm overflow-hidden">
      <div className="border-r border-border flex flex-col min-h-0">
        <div className="p-3 border-b border-border">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar conversa…"
            className="w-full border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted p-4 text-center">Nenhuma conversa ainda.</p>
          ) : (
            filtered.map((c) => {
              const key = keyOf(c);
              const last = c.messages[0];
              const active = key === selectedKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={`w-full text-left flex items-center gap-3 px-3 py-3 border-b border-border cursor-pointer ${
                    active ? "bg-primary-faint" : "hover:bg-bg"
                  }`}
                >
                  <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
                    {initials(c.contact.name, c.contact.phone)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold truncate flex items-center gap-1">
                        {c.contact.needs_attention && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-warning-text shrink-0" aria-hidden>
                            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12" y2="17" />
                          </svg>
                        )}
                        {c.contact.name || c.contact.phone || "sem nome"}
                      </span>
                      {last && <time className="text-[11px] text-text-muted shrink-0">{formatTime(last.created_at)}</time>}
                    </div>
                    <p className="text-xs text-text-muted truncate">
                      {c.contact.needs_attention ? c.contact.attention_reason || "Precisa de atenção" : last?.content || ""}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <div className="flex flex-col min-h-0">
        {!selected ? (
          <div className="flex-1 grid place-items-center text-text-muted text-sm">Selecione uma conversa</div>
        ) : (
          <>
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <span className="grid place-items-center w-9 h-9 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
                {initials(selected.contact.name, selected.contact.phone)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold truncate">{selected.contact.name || selected.contact.phone}</div>
                <div className="text-xs text-text-muted truncate">{selected.contact.phone} · agente {selected.agent.name}</div>
              </div>
              <button
                type="button"
                onClick={() => (selected.contact.needs_attention ? handleResolve(selected.contact.id) : handleTakeOver(selected.contact.id))}
                disabled={pending}
                className={`text-xs font-bold px-3 py-2 rounded-md shrink-0 cursor-pointer disabled:opacity-60 ${
                  selected.contact.needs_attention ? "bg-primary-strong text-white" : "border border-border text-text-muted"
                }`}
              >
                {selected.contact.needs_attention ? "Devolver pro agente" : "Assumir conversa"}
              </button>
            </div>

            {selected.contact.needs_attention && (
              <div className="bg-warning-soft text-warning-text text-xs font-semibold px-4 py-2">
                {selected.contact.attention_reason || "Conversa assumida manualmente."} O agente não responde até você devolver.
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto p-4 flex flex-col gap-2">
              {orderedMessages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                    m.role === "user" ? "bg-bg self-start" : "bg-primary-soft text-primary-strong self-end"
                  }`}
                >
                  {m.content}
                  <div className="text-[10px] text-text-muted mt-1">{formatTime(m.created_at)}</div>
                </div>
              ))}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSend();
              }}
              className="flex items-center gap-2 p-3 border-t border-border"
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                disabled={!selected.contact.needs_attention || pending}
                placeholder={selected.contact.needs_attention ? "Escreva a mensagem…" : "Assuma a conversa pra escrever manualmente"}
                className="flex-1 border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!selected.contact.needs_attention || pending || !draft.trim()}
                className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Enviar
              </button>
            </form>
          </>
        )}
        {error && <p className="text-xs text-danger font-medium px-4 pb-2">{error}</p>}
      </div>
    </div>
  );
}

function keyOf(c: Conversation) {
  return `${c.contact.id}:${c.agent.id}`;
}
