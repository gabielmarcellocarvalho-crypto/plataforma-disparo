"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAgent, type CreateAgentState } from "@/app/actions/agents";

const INITIAL_STATE: CreateAgentState = { error: null };

export function AddAgentForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(createAgent, INITIAL_STATE);

  useEffect(() => {
    if (state.ok) {
      dialogRef.current?.close();
      formRef.current?.reset();
    }
  }, [state.ok]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        Adicionar agente
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-lg"
      >
        <form ref={formRef} action={formAction} className="flex flex-col gap-4 p-6">
          <div>
            <h2 className="text-lg font-extrabold">Adicionar agente</h2>
            <p className="text-xs text-text-muted mt-1">
              Cada agente conecta o próprio número de WhatsApp e responde sozinho. A configuração completa
              (tom, horários, dados a coletar) fica disponível no card depois de criar.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="agent-name" className="text-sm font-semibold">
              Nome do agente
            </label>
            <input
              id="agent-name"
              name="name"
              placeholder="Ex: Reativação de base"
              required
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="agent-company" className="text-sm font-semibold">
              Nome da empresa
            </label>
            <input
              id="agent-company"
              name="company_name"
              placeholder="Ex: Hotel Fazenda Ecoville"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="agent-business-type" className="text-sm font-semibold">
              Tipo de negócio
            </label>
            <input
              id="agent-business-type"
              name="business_type"
              placeholder="Ex: hotel fazenda, clínica odontológica"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm font-semibold text-text-muted px-4 py-2.5 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
            >
              {pending ? "Criando…" : "Criar agente"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
