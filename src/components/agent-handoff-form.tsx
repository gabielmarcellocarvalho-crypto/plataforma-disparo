"use client";

import { useState, useTransition } from "react";
import { updateAgentHandoff } from "@/app/actions/agents";
import { HANDOFF_SIGNALS } from "@/lib/agent-handoff";
import { signalLabel } from "@/lib/pipelines";

export type HandoffAgentOption = { id: string; name: string; temNumero: boolean };

const INPUT = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface";

export function AgentHandoffForm({
  agentId,
  agentes,
  initial,
}: {
  agentId: string;
  // Outros agentes do workspace — o de destino. O próprio agente fica de fora: passar pra si mesmo
  // seria um laço.
  agentes: HandoffAgentOption[];
  initial: { toAgentId: string | null; mode: string; signal: string; intro: string; notice: string };
}) {
  const [toAgentId, setToAgentId] = useState(initial.toAgentId ?? "");
  const [mode, setMode] = useState(initial.mode === "numero" ? "numero" : "papel");
  const [signal, setSignal] = useState(initial.signal || "encaminhamento");
  const [intro, setIntro] = useState(initial.intro);
  const [notice, setNotice] = useState(initial.notice);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const destino = agentes.find((a) => a.id === toAgentId) ?? null;
  const ligado = Boolean(toAgentId);

  function salvar() {
    setErro(null);
    setSalvo(false);
    startTransition(async () => {
      const r = await updateAgentHandoff(agentId, { toAgentId: toAgentId || null, mode, signal, intro, notice });
      if (r.error) setErro(r.error);
      else setSalvo(true);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-muted">
        Quando este agente qualificar o lead, outro agente assume a conversa. Serve pra separar quem
        qualifica de quem fecha, com objetivos e tons diferentes. Deixe em &quot;ninguém&quot; para o
        agente conduzir do começo ao fim, que é o comportamento padrão.
      </p>

      <div className="grid sm:grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">Quem assume</label>
          <select value={toAgentId} onChange={(e) => setToAgentId(e.target.value)} className={`${INPUT} cursor-pointer`}>
            <option value="">— ninguém (sem passagem)</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.temNumero ? "" : " (sem número próprio)"}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">A partir de qual classificação</label>
          <select value={signal} onChange={(e) => setSignal(e.target.value)} disabled={!ligado} className={`${INPUT} cursor-pointer disabled:opacity-50`}>
            {HANDOFF_SIGNALS.map((s) => (
              <option key={s} value={s}>
                {signalLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {ligado && (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-text-muted">Como a passagem acontece</span>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" checked={mode === "papel"} onChange={() => setMode("papel")} className="mt-1 cursor-pointer accent-[var(--color-primary-strong)]" />
              <span>
                <b className="font-semibold">Mesmo número</b>
                <span className="block text-[11px] text-text-muted leading-snug">
                  A conversa continua onde está; só muda quem responde por trás. O cliente não percebe
                  troca nenhuma. O agente que assume nem precisa de número próprio.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="radio" checked={mode === "numero"} onChange={() => setMode("numero")} className="mt-1 cursor-pointer accent-[var(--color-primary-strong)]" />
              <span>
                <b className="font-semibold">Outro número</b>
                <span className="block text-[11px] text-text-muted leading-snug">
                  Quem assume se apresenta pelo número dele e conduz dali. Para times com caixas de
                  entrada separadas.
                </span>
              </span>
            </label>
          </div>

          {mode === "numero" && (
            <>
              {destino && !destino.temNumero && (
                <p className="text-xs text-warning-text bg-warning-soft rounded-md px-3 py-2">
                  <b>{destino.name}</b> não tem número conectado, então não consegue se apresentar. Enquanto
                  isso, a conversa continua no número atual com o objetivo do agente que assume — na
                  prática, igual ao modo &quot;mesmo número&quot;.
                </p>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-text-muted">
                  Apresentação de quem assume <span className="font-normal">— enviada pelo número de {destino?.name ?? "destino"}</span>
                </label>
                <textarea
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  rows={2}
                  placeholder="Ex.: Oi! A partir daqui quem continua com você sou eu."
                  className={`${INPUT} resize-y`}
                />
                <span className="text-[11px] text-text-muted">
                  O cliente vê um número desconhecido aparecer do nada — sem uma apresentação, a conversa fica confusa.
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-text-muted">Se o cliente responder no número antigo</label>
                <textarea
                  value={notice}
                  onChange={(e) => setNotice(e.target.value)}
                  rows={2}
                  placeholder="Deixe vazio para usar o texto padrão."
                  className={`${INPUT} resize-y`}
                />
                <span className="text-[11px] text-text-muted">
                  Este número responde isso uma vez e para. Sem essa mensagem, a escolha seria entre
                  ignorar o cliente ou ter dois agentes falando por cima um do outro.
                </span>
              </div>
            </>
          )}
        </>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={salvar}
          disabled={pending}
          className="bg-primary-strong text-white text-sm font-bold px-4 py-2 rounded-md cursor-pointer disabled:opacity-60"
        >
          Salvar
        </button>
        {salvo && <span className="text-xs font-semibold text-success">Salvo.</span>}
        {erro && <span className="text-xs text-danger font-medium">{erro}</span>}
      </div>
    </div>
  );
}
