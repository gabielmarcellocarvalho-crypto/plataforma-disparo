"use client";

import { useActionState } from "react";
import Link from "next/link";
import { requestPasswordReset, type ForgotPasswordState } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth-shell";

const INITIAL_STATE: ForgotPasswordState = { error: null };

export default function EsqueciSenhaPage() {
  const [state, formAction, pending] = useActionState(requestPasswordReset, INITIAL_STATE);

  return (
    <AuthShell title="Recuperar senha" subtitle="Informe seu e-mail pra receber o link de redefinição">
      {state.sent ? (
        <p className="text-sm text-text leading-relaxed">
          Se esse e-mail tiver uma conta na plataforma, você recebe um link pra redefinir a senha em instantes. Confira
          também a caixa de spam.
        </p>
      ) : (
        <form action={formAction} className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-semibold text-text">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@empresa.com"
              className="w-full border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft placeholder:text-text-muted/60"
            />
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <button
            type="submit"
            disabled={pending}
            className="bg-primary-strong text-white font-bold text-sm rounded-md py-2.5 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {pending ? "Enviando…" : "Enviar link"}
          </button>
        </form>
      )}

      <Link href="/login" className="text-center text-sm font-semibold text-primary-strong hover:underline">
        Voltar pro login
      </Link>
    </AuthShell>
  );
}
