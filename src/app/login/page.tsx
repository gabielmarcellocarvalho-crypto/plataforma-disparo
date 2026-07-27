"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { signIn, type SignInState } from "./actions";

const INITIAL_STATE: SignInState = { error: null };

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

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);
  const [showPassword, setShowPassword] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const setSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    setSize();

    type P = { x: number; y: number; v: number; o: number };
    let ps: P[] = [];
    let raf = 0;

    const make = (): P => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      v: Math.random() * 0.25 + 0.05,
      o: Math.random() * 0.3 + 0.1,
    });

    const init = () => {
      ps = Array.from({ length: Math.floor((canvas.width * canvas.height) / 11000) }, make);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of ps) {
        p.y -= p.v;
        if (p.y < 0) {
          p.x = Math.random() * canvas.width;
          p.y = canvas.height + Math.random() * 40;
          p.v = Math.random() * 0.25 + 0.05;
          p.o = Math.random() * 0.3 + 0.1;
        }
        ctx.fillStyle = `rgba(233,225,255,${p.o})`;
        ctx.fillRect(p.x, p.y, 1, 2.4);
      }
      raf = requestAnimationFrame(draw);
    };

    const onResize = () => {
      setSize();
      init();
    };

    window.addEventListener("resize", onResize);
    init();
    raf = requestAnimationFrame(draw);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden" style={{ background: "linear-gradient(160deg, var(--color-sidebar) 0%, var(--color-sidebar-deep) 100%)" }}>
      <style>{`
        .login-vline,.login-hline{position:absolute;background:var(--color-sidebar-border);will-change:transform,opacity}
        .login-hline{left:0;right:0;height:1px;transform:scaleX(0);transform-origin:50% 50%;animation:loginDrawX .8s cubic-bezier(.22,.61,.36,1) forwards}
        .login-vline{top:0;bottom:0;width:1px;transform:scaleY(0);transform-origin:50% 0%;animation:loginDrawY .9s cubic-bezier(.22,.61,.36,1) forwards}
        .login-hline:nth-child(1){top:20%;animation-delay:.1s}
        .login-hline:nth-child(2){top:80%;animation-delay:.24s}
        .login-vline:nth-child(3){left:20%;animation-delay:.38s}
        .login-vline:nth-child(4){left:80%;animation-delay:.5s}
        @keyframes loginDrawX{0%{transform:scaleX(0);opacity:0}60%{opacity:.9}100%{transform:scaleX(1);opacity:.6}}
        @keyframes loginDrawY{0%{transform:scaleY(0);opacity:0}60%{opacity:.9}100%{transform:scaleY(1);opacity:.6}}
        .login-card{opacity:0;transform:translateY(16px);animation:loginFadeUp .7s cubic-bezier(.22,.61,.36,1) .15s forwards}
        @keyframes loginFadeUp{to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Vinheta suave, mesma composição do sidebar (roxo profundo) */}
      <div className="absolute inset-0 pointer-events-none [background:radial-gradient(70%_55%_at_50%_28%,rgba(255,255,255,0.08),transparent_60%)]" />

      <div className="absolute inset-0 pointer-events-none opacity-70">
        <div className="login-hline" />
        <div className="login-hline" />
        <div className="login-vline" />
        <div className="login-vline" />
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />

      <div className="absolute left-0 right-0 top-0 px-6 py-5">
        <span className="text-xs font-bold tracking-[0.16em] uppercase text-sidebar-text">Plataforma de Disparo</span>
      </div>

      <div className="relative h-full w-full grid place-items-center px-4">
        <form
          action={formAction}
          className="login-card w-full max-w-sm bg-surface/[0.98] backdrop-blur-sm border border-white/10 rounded-2xl shadow-lg p-7 flex flex-col gap-5"
        >
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text">Bem-vindo de volta</h1>
            <p className="text-sm text-text-muted mt-1">Entre na sua conta pra continuar</p>
          </div>

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
            <label htmlFor="password" className="text-sm font-semibold text-text">
              Senha
            </label>
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

          <p className="text-center text-xs text-text-muted">Acesso restrito à equipe e clientes convidados.</p>
        </form>
      </div>
    </div>
  );
}
