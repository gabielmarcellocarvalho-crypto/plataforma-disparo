"use client";

import { useActionState } from "react";
import { createWorkspace, type CreateWorkspaceState } from "@/app/actions/workspace";

const INITIAL_STATE: CreateWorkspaceState = { error: null };

export function CreateWorkspaceForm() {
  const [state, formAction, pending] = useActionState(createWorkspace, INITIAL_STATE);

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
