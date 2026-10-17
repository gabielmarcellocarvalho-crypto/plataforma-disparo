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

export function AgentQaInbox({ agents, rows }: { agents: { id: string; name: string }[]; rows: QaRow[] }) {
  const [tab, setTab] = useState<"caixa" | "faq">("caixa");
  const [agentId, setAgentId] = useState<string>("todos");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? "agente";
  const inAgent = (r: QaRow) => agentId === "todos" || r.agent_id === agentId;
  const inbox = rows.filter((r) => r.status === "pendente" && inAgent(r));
  const faq = rows.filter((r) => r.status === "respondida" && inAgent(r));
  const totalPending = rows.filter((r) => r.status === "pendente").length;

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
    <section className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          {tabBtn("caixa", `Perguntas${totalPending ? ` (${totalPending})` : ""}`)}
          {tabBtn("faq", "Perguntas frequentes")}
        </div>
        {agents.length > 1 && (
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="border border-border rounded-md px-2.5 py-1.5 text-sm bg-surface outline-none focus:border-primary">
            <option value="todos">Todos os agentes</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        )}
      </div>
      {error && <p className="text-xs text-danger font-medium">{error}</p>}

      {tab === "caixa" ? (
        <>
          <p className="text-xs text-text-muted -mt-2">
            Dúvidas que o agente não soube responder. Ele avisou o cliente que ia confirmar com a equipe. A resposta que você der vira memória dele para as próximas conversas.
          </p>
          {inbox.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">Nenhuma pergunta pendente.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {inbox.map((r) => (
                <PendingItem key={r.id} row={r} agentLabel={agents.length > 1 ? agentName(r.agent_id) : null} busy={pending} run={run} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="text-xs text-text-muted -mt-2">Perguntas e respostas que o agente já sabe. Adicione as mais comuns para ele responder direto.</p>
          <FaqForm agents={agents} defaultAgent={agentId} busy={pending} run={run} />
          {faq.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-4">Nada cadastrado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {faq.map((r) => (
                <FaqItem key={r.id} row={r} agentLabel={agents.length > 1 ? agentName(r.agent_id) : null} busy={pending} run={run} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function PendingItem({ row, agentLabel, busy, run }: { row: QaRow; agentLabel: string | null; busy: boolean; run: Run }) {
  const [answer, setAnswer] = useState("");
  return (
    <li className="border border-border rounded-md p-3 flex flex-col gap-2">
      <div className="text-xs text-text-muted">
        {row.contact_label ? `${row.contact_label} · ` : ""}
        {fmt(row.created_at)}
        {agentLabel ? ` · ${agentLabel}` : ""}
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

function FaqForm({ agents, defaultAgent, busy, run }: { agents: { id: string; name: string }[]; defaultAgent: string; busy: boolean; run: Run }) {
  const [agent, setAgent] = useState(defaultAgent !== "todos" ? defaultAgent : agents[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  if (agents.length === 0) return null;
  return (
    <div className="border border-border rounded-md p-3 flex flex-col gap-2 bg-bg">
      {agents.length > 1 && (
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className="border border-border rounded-md px-2.5 py-1.5 text-sm bg-surface outline-none focus:border-primary self-start">
          {agents.map((x) => (
            <option key={x.id} value={x.id}>{x.name}</option>
          ))}
        </select>
      )}
      <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder="Pergunta (ex.: Vocês trocam produto?)" className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary bg-surface" />
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={2} maxLength={2000} placeholder="Resposta" className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary resize-y bg-surface" />
      <button
        type="button"
        disabled={busy || !q.trim() || !a.trim() || !agent}
        onClick={() =>
          run(() => addFaq(agent, q, a), () => {
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

function FaqItem({ row, agentLabel, busy, run }: { row: QaRow; agentLabel: string | null; busy: boolean; run: Run }) {
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
              {agentLabel ? ` · ${agentLabel}` : ""}
            </span>
            <button type="button" onClick={() => setEditing(true)} className="font-bold text-primary-strong cursor-pointer">Editar</button>
            <button type="button" disabled={busy} onClick={() => run(() => deleteQa(row.id))} className="font-bold text-text-muted hover:text-danger cursor-pointer">Excluir</button>
          </div>
        </>
      )}
    </li>
  );
}
