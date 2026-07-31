"use client";

import { useActionState, useState } from "react";
import { createWorkspace, type CreateWorkspaceState } from "@/app/actions/workspace";
import { WORKSPACE_PLANS, type WorkspacePlan } from "@/lib/workspace-plan";

const INITIAL_STATE: CreateWorkspaceState = { error: null };

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspace, INITIAL_STATE);
  const [plan, setPlan] = useState<WorkspacePlan | "">("");

  return (
    <form action={formAction} className="w-full max-w-sm bg-surface border border-border rounded-lg shadow-md p-7 flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight">Cadastrar cliente</h1>
        <p className="text-sm text-text-muted mt-1">Cria o primeiro workspace da plataforma.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className="text-sm font-semibold">
          Nome do cliente
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          placeholder="Ex.: Hanoi Editora"
          className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">Plano</span>
        <input type="hidden" name="plan" value={plan} />
        <div className="flex flex-col gap-2">
          {WORKSPACE_PLANS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setPlan(p.key)}
              className={`text-left p-3 rounded-lg border cursor-pointer transition-colors ${
                plan === p.key ? "border-primary-strong bg-primary-faint" : "border-border hover:border-primary-soft"
              }`}
            >
              <div className={`text-sm font-bold ${plan === p.key ? "text-primary-strong" : ""}`}>{p.label}</div>
              <div className="text-[11px] text-text-muted mt-0.5 leading-snug">{p.short}</div>
            </button>
          ))}
        </div>
        <p className="text-xs text-text-muted">Define até onde vai o funil de conversão mostrado na Visão geral. Dá pra mudar depois em Configurações.</p>
      </div>

      {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary-strong text-white font-bold text-sm rounded-md py-2.5 mt-1 disabled:opacity-60"
      >
        {pending ? "Criando…" : "Criar workspace"}
      </button>
    </form>
  );
}
