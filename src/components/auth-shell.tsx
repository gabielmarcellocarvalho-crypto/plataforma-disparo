"use client";

import { useEffect, useRef } from "react";

// Casca visual compartilhada pelas telas de autenticação (login, esqueci senha, redefinir senha) —
// gradiente roxo profundo do sidebar, linhas animadas e partículas subindo, card branco flutuante.
export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
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
        ctx.fillStyle = `rgba(255,225,229,${p.o})`;
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

      <div className="absolute inset-0 pointer-events-none [background:radial-gradient(70%_55%_at_50%_28%,rgba(255,255,255,0.08),transparent_60%)]" />

      <div className="absolute inset-0 pointer-events-none opacity-70">
        <div className="login-hline" />
        <div className="login-hline" />
        <div className="login-vline" />
        <div className="login-vline" />
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden />

      <div className="absolute left-0 right-0 top-0 px-6 py-5">
        <span className="text-xs font-bold tracking-[0.16em] uppercase text-sidebar-text">V4 Operator</span>
      </div>

      <div className="relative h-full w-full grid place-items-center px-4">
        <div className="login-card w-full max-w-sm bg-surface/[0.98] backdrop-blur-sm border border-white/10 rounded-2xl shadow-lg p-7 flex flex-col gap-5">
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-text">{title}</h1>
            <p className="text-sm text-text-muted mt-1">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
