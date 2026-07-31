"use client";

import { useActionState } from "react";
import { updatePassword, type UpdatePasswordState } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth-shell";

const INITIAL_STATE: UpdatePasswordState = { error: null };

export default function RedefinirSenhaPage() {
  const [state, formAction, pending] = useActionState(updatePassword, INITIAL_STATE);

  return (
    <AuthShell title="Nova senha" subtitle="Escolha uma senha nova pra sua conta">
      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-semibold text-text">
            Nova senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="mínimo 6 caracteres"
            className="w-full border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="confirm" className="text-sm font-semibold text-text">
            Confirmar senha
          </label>
          <input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="digite de novo"
            className="w-full border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>

        {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="bg-primary-strong text-white font-bold text-sm rounded-md py-2.5 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Salvando…" : "Salvar nova senha"}
        </button>
      </form>
    </AuthShell>
  );
}
