"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createCampaign, type ActionResult } from "@/app/actions/campaigns";

const INITIAL_STATE: ActionResult = { error: null };

type AgentOption = { id: string; name: string; connection_status: string };

export function CreateCampaignForm({ agents = [] }: { agents?: AgentOption[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [mode, setMode] = useState<"blast" | "agent">("blast");
  const [agentId, setAgentId] = useState(agents[0]?.id || "");
  const [state, formAction, pending] = useActionState(createCampaign, INITIAL_STATE);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  useEffect(() => {
    if (channel !== "whatsapp") setMode("blast");
  }, [channel]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        Nova campanha
      </button>

      <dialog ref={dialogRef} className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-lg">
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Nova campanha</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-semibold">
              Nome
            </label>
            <input id="name" name="name" required className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="channel" className="text-sm font-semibold">
              Canal
            </label>
            <select
              id="channel"
              name="channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as "whatsapp" | "email")}
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
            </select>
          </div>

          {channel === "whatsapp" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Quem conduz o disparo</span>
              <input type="hidden" name="mode" value={mode} />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("blast")}
                  aria-pressed={mode === "blast"}
                  className={`text-left border rounded-md p-3 cursor-pointer transition-colors ${
                    mode === "blast" ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                  }`}
                >
                  <div className="text-sm font-bold">Disparo simples</div>
                  <div className="text-xs text-text-muted mt-0.5">Manda a mensagem fixa (ou uma variação por linha) e não responde depois.</div>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("agent")}
                  aria-pressed={mode === "agent"}
                  disabled={agents.length === 0}
                  className={`text-left border rounded-md p-3 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    mode === "agent" ? "border-primary bg-primary-faint" : "border-border hover:bg-bg"
                  }`}
                >
                  <div className="text-sm font-bold">Agente de IA</div>
                  <div className="text-xs text-text-muted mt-0.5">
                    {agents.length === 0 ? "Crie um agente na aba Agentes primeiro." : "Um agente manda a abertura e conduz a conversa sozinho depois."}
                  </div>
                </button>
              </div>
            </div>
          )}

          {channel === "whatsapp" && mode === "agent" && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="agent_id" className="text-sm font-semibold">
                Agente
              </label>
              <select
                id="agent_id"
                name="agent_id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
              >
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} {a.connection_status !== "open" ? "(desconectado)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="templates" className="text-sm font-semibold">
              {mode === "agent" ? "Mensagem de abertura" : "Mensagem(ns)"}
            </label>
            <textarea
              id="templates"
              name="templates"
              rows={5}
              required
              placeholder={
                mode === "agent"
                  ? "Primeira mensagem que o agente manda pra puxar assunto. Uma variação por linha. Use {nome} pro primeiro nome."
                  : "Uma variação por linha. Use {nome} pro primeiro nome."
              }
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary font-mono"
            />
            {mode === "agent" && (
              <p className="text-xs text-text-muted">Depois dessa mensagem, o agente responde sozinho seguindo o prompt configurado na aba Agentes.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delay_min" className="text-xs font-semibold text-text-muted">
                Delay mín. (s)
              </label>
              <input id="delay_min" name="delay_min" type="number" defaultValue={60} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="delay_max" className="text-xs font-semibold text-text-muted">
                Delay máx. (s)
              </label>
              <input id="delay_max" name="delay_max" type="number" defaultValue={180} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hour_start" className="text-xs font-semibold text-text-muted">
                Janela início (h)
              </label>
              <input id="hour_start" name="hour_start" type="number" defaultValue={9} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="hour_end" className="text-xs font-semibold text-text-muted">
                Janela fim (h)
              </label>
              <input id="hour_end" name="hour_end" type="number" defaultValue={20} className="border border-border rounded-md px-3 py-2 text-sm outline-none focus:border-primary" />
            </div>
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button type="button" onClick={() => dialogRef.current?.close()} className="text-sm font-semibold text-text-muted px-4 py-2.5 cursor-pointer">
              Cancelar
            </button>
            <button type="submit" disabled={pending} className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed">
              {pending ? "Criando…" : "Criar campanha"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
