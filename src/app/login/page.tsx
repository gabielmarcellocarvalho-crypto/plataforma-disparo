"use client";

import { Suspense, useActionState, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn, type SignInState } from "./actions";
import { signInWithGoogle } from "@/app/actions/auth";
import { AuthShell } from "@/components/auth-shell";

const INITIAL_STATE: SignInState = { error: null };

const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  sem_acesso: "Essa conta ainda não tem acesso à plataforma. Peça pra equipe criar seu login.",
  auth: "Não foi possível concluir o login. Tente de novo.",
  google: "Não foi possível iniciar o login com Google. Tente de novo.",
};

function MailIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3l18 18" />
      <path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c5.5 0 9.5 4.5 10.5 7-.4 1-1.1 2.1-2 3.1M6.6 6.6C4.5 8 3 10 1.5 12c1.2 2.6 4.2 7 10.5 7 1.5 0 2.9-.3 4.1-.8" />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.47a5.54 5.54 0 0 1-2.4 3.64v3h3.88c2.27-2.09 3.57-5.17 3.57-8.83Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.9l-3.88-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.26v3.11A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.6H1.26A12 12 0 0 0 0 12c0 1.94.46 3.77 1.26 5.4l4.01-3.11Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.79l3.44-3.44C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.26 6.6l4.01 3.11C6.22 6.86 8.87 4.75 12 4.75Z" />
    </svg>
  );
}

function OAuthErrorBanner() {
  const searchParams = useSearchParams();
  const message = OAUTH_ERROR_MESSAGES[searchParams.get("erro") || ""];
  if (!message) return null;
  return <p className="text-sm text-danger font-medium bg-danger-soft rounded-md px-3 py-2.5 -mt-1">{message}</p>;
}

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <AuthShell title="Bem-vindo de volta" subtitle="Entre na sua conta pra continuar">
      <Suspense fallback={null}>
        <OAuthErrorBanner />
      </Suspense>

      <form action={formAction} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-sm font-semibold text-text">
            E-mail
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
              <MailIcon />
            </span>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@empresa.com"
              className="w-full border border-border rounded-md pl-10 pr-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft placeholder:text-text-muted/60"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="text-sm font-semibold text-text">
              Senha
            </label>
            <Link href="/esqueci-senha" className="text-xs font-semibold text-primary-strong hover:underline">
              Esqueceu a senha?
            </Link>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
              <LockIcon />
            </span>
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="w-full border border-border rounded-md pl-10 pr-10 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft"
            />
            <button
              type="button"
              aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-text-muted hover:text-text cursor-pointer"
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>
        </div>

        {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="bg-primary-strong text-white font-bold text-sm rounded-md py-2.5 mt-1 cursor-pointer transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>

      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-surface px-2 text-xs text-text-muted">ou</span>
        </div>
      </div>

      <form action={signInWithGoogle}>
        <button
          type="submit"
          className="w-full flex items-center justify-center gap-2.5 border border-border rounded-md py-2.5 text-sm font-semibold text-text cursor-pointer hover:bg-bg transition-colors"
        >
          <GoogleIcon />
          Entrar com Google
        </button>
      </form>

      <p className="text-center text-xs text-text-muted">Acesso restrito à equipe e clientes convidados.</p>
    </AuthShell>
  );
}
