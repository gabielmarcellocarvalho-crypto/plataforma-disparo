"use client";

import { useState, useTransition } from "react";
import { addFaq, answerQuestion, deleteQa, discardQuestion, updateQa, type QaResult } from "@/app/actions/agent-qa";

export type QaRow = {
  id: string;
  agent_id: string;
  question: string;
  answer: string | null;
  status: "pendente" | "respondida" | "descartada";
  source: "agente" | "manual";
  created_at: string;
  contact_label: string | null;
};

const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Run = (fn: () => Promise<QaResult>, onOk?: () => void) => void;

// Caixa "Perguntas" de UM agente, recolhida por padrão, que fica embaixo do card dele. O pontinho vermelho
// em cima da palavra aparece enquanto houver pergunta esperando resposta.
export function AgentQaBox({ agentId, rows }: { agentId: string; rows: QaRow[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"caixa" | "faq">("caixa");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mine = rows.filter((r) => r.agent_id === agentId);
  const inbox = mine.filter((r) => r.status === "pendente");
  const faq = mine.filter((r) => r.status === "respondida");

  const run: Run = (fn, onOk) => {
    setError(null);
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else onOk?.();
    });
  };

  const tabBtn = (key: "caixa" | "faq", label: string) => (
    <button
      type="button"
      onClick={() => setTab(key)}
      className={`text-sm font-bold px-3 py-1.5 rounded-md cursor-pointer ${tab === key ? "bg-primary-faint text-primary-strong" : "text-text-muted hover:text-text"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 cursor-pointer"
      >
        <span className="relative text-sm font-bold">
          Perguntas
          {inbox.length > 0 && (
            <span
              className="absolute -top-1 -right-2.5 w-2 h-2 rounded-full bg-danger"
              title={`${inbox.length} pergunta(s) esperando resposta`}
              aria-label={`${inbox.length} pergunta(s) esperando resposta`}
            />
          )}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-text-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border p-4 flex flex-col gap-4">
          <div className="flex items-center gap-1">
            {tabBtn("caixa", `Caixa de entrada${inbox.length ? ` (${inbox.length})` : ""}`)}
            {tabBtn("faq", "Perguntas frequentes")}
          </div>
          {error && <p className="text-xs text-danger font-medium">{error}</p>}

          {tab === "caixa" ? (
            <>
              <p className="text-xs text-text-muted -mt-2">
                Dúvidas que o agente não soube responder. A resposta que você der vira memória dele para as próximas conversas.
              </p>
              {inbox.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">Nenhuma pergunta pendente.</p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {inbox.map((r) => (
                    <PendingItem key={r.id} row={r} busy={pending} run={run} />
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-text-muted -mt-2">Perguntas e respostas que o agente já sabe. Adicione as mais comuns para ele responder direto.</p>
              <FaqForm agentId={agentId} busy={pending} run={run} />
              {faq.length === 0 ? (
                <p className="text-sm text-text-muted text-center py-4">Nada cadastrado ainda.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {faq.map((r) => (
                    <FaqItem key={r.id} row={r} busy={pending} run={run} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PendingItem({ row, busy, run }: { row: QaRow; busy: boolean; run: Run }) {
  const [answer, setAnswer] = useState("");
  return (
    <li className="border border-border rounded-md p-3 flex flex-col gap-2">
      <div className="text-xs text-text-muted">
        {row.contact_label ? `${row.contact_label} · ` : ""}
        {fmt(row.created_at)}
      </div>
      <div className="text-sm font-semibold">{row.question}</div>
      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="Escreva a resposta para o agente guardar…"
        className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y"
      />
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !answer.trim()}
          onClick={() => run(() => answerQuestion(row.id, answer))}
          className="bg-primary-strong text-white text-sm font-bold px-3.5 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
        >
          Responder e salvar
        </button>
        <button type="button" disabled={busy} onClick={() => run(() => discardQuestion(row.id))} className="text-xs font-bold text-text-muted hover:text-danger cursor-pointer">
          Descartar
        </button>
      </div>
    </li>
  );
}

function FaqForm({ agentId, busy, run }: { agentId: string; busy: boolean; run: Run }) {
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  return (
    <div className="border border-border rounded-md p-3 flex flex-col gap-2 bg-bg">
      <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Pergunta (ex.: Vocês trocam produto?)" className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary bg-surface" />
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2} maxLength={2000} placeholder="Resposta" className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y bg-surface" />
      <button
        type="button"
        disabled={busy || !q.trim() || !a.trim()}
        onClick={() =>
          run(() => addFaq(agentId, q, a), () => {
            setQ("");
            setA("");
          })
        }
        className="bg-primary-strong text-white text-sm font-bold px-3.5 py-1.5 rounded-md cursor-pointer disabled:opacity-60 self-start"
      >
        Adicionar
      </button>
    </div>
  );
}

function FaqItem({ row, busy, run }: { row: QaRow; busy: boolean; run: Run }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(row.question);
  const [a, setA] = useState(row.answer ?? "");
  return (
    <li className="border border-border rounded-md p-3 flex flex-col gap-1.5">
      {editing ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
          <textarea value={a} onChange={(e) => setA(e.target.value)} rows={3} maxLength={2000} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y" />
          <div className="flex gap-3">
            <button type="button" disabled={busy || !q.trim() || !a.trim()} onClick={() => run(() => updateQa(row.id, q, a), () => setEditing(false))} className="text-xs font-bold text-primary-strong cursor-pointer disabled:opacity-60">
              Salvar
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs font-bold text-text-muted cursor-pointer">Cancelar</button>
          </div>
        </>
      ) : (
        <>
          <div className="text-sm font-semibold">{row.question}</div>
          <div className="text-sm text-text-muted whitespace-pre-wrap">{row.answer}</div>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-text-muted">
              {row.source === "manual" ? "Cadastrada pela equipe" : "Respondida pela equipe"}
            </span>
            <button type="button" onClick={() => setEditing(true)} className="font-bold text-primary-strong cursor-pointer">Editar</button>
            <button type="button" disabled={busy} onClick={() => run(() => deleteQa(row.id))} className="font-bold text-text-muted hover:text-danger cursor-pointer">Excluir</button>
          </div>
        </>
      )}
    </li>
  );
}
