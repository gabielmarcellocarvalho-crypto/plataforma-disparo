"use client";

import { useTransition } from "react";
import { resolveAttention } from "@/app/actions/conversations";

type AttentionContact = { id: string; name: string | null; phone: string | null; attention_reason: string | null };

export function AttentionPanel({ contacts }: { contacts: AttentionContact[] }) {
  const [pending, startTransition] = useTransition();

  if (!contacts.length) return null;

  function handleResolve(contactId: string) {
    startTransition(async () => {
      await resolveAttention(contactId);
    });
  }

  return (
    <div className="bg-surface border border-warning-text/20 rounded-lg shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-warning-text" aria-hidden>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12" y2="17" />
        </svg>
        <h3 className="font-bold text-[15px]">Precisa de atenção ({contacts.length})</h3>
      </div>
      <p className="text-xs text-text-muted -mt-2">Conversas em que os agentes pararam de responder automaticamente até alguém revisar.</p>

      <ul className="flex flex-col gap-2">
        {contacts.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 border border-border rounded-md px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{c.name || c.phone || "contato sem nome"}</div>
              <div className="text-xs text-text-muted truncate">{c.attention_reason}</div>
            </div>
            <button
              type="button"
              onClick={() => handleResolve(c.id)}
              disabled={pending}
              className="text-xs font-bold text-primary-strong hover:underline shrink-0 cursor-pointer disabled:opacity-60"
            >
              Marcar como resolvido
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
