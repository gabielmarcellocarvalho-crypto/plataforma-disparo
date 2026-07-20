"use client";

import { useActionState } from "react";
import { signIn, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <form action={formAction} className="w-full max-w-sm bg-surface border border-border rounded-lg shadow-md p-7 flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Entrar</h1>
          <p className="text-sm text-text-muted mt-1">Plataforma de Disparo</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-semibold">
            E-mail
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-semibold">
            Senha
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
          />
        </div>

        {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="bg-primary-strong text-white font-bold text-sm rounded-md py-2.5 mt-1 disabled:opacity-60"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
