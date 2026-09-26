"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

// Card de integração, no molde do "ServiceCard": título grande, chamada com seta que anda no hover e
// uma ilustração grande vazando pelo canto inferior direito. Cores sempre dos tokens do projeto —
// nada de paleta própria, pra continuar parecendo a mesma plataforma.

const VARIANTS = {
  // Integração disponível: superfície branca, ganha borda de destaque no hover.
  default: "bg-surface text-text border border-border hover:border-primary-soft",
  // Destaque (integração em uso): fundo vermelho da marca.
  brand: "bg-primary-strong text-white border border-primary-strong",
  // Em breve: apagado e sem interação.
  muted: "bg-surface-2 text-text-muted border border-dashed border-border-strong",
} as const;

export type IntegrationCardVariant = keyof typeof VARIANTS;

export type IntegrationCardProps = {
  title: string;
  description: string;
  // Chamada da parte de baixo ("Configurar", "Em breve"). Sem href o card não é clicável.
  cta: string;
  href?: string;
  // Selo no topo (ex.: "2 conectados").
  badge?: React.ReactNode;
  // Logo/ilustração grande do canto. Decorativa — o nome já está no título.
  art: React.ReactNode;
  variant?: IntegrationCardVariant;
  className?: string;
};

export function IntegrationCard({ title, description, cta, href, badge, art, variant = "default", className }: IntegrationCardProps) {
  const reduce = useReducedMotion();
  const interactive = Boolean(href);

  const card = {
    rest: { scale: 1 },
    hover: reduce || !interactive ? {} : { scale: 1.02, transition: { duration: 0.25, ease: "easeOut" as const } },
  };
  const artMotion = {
    rest: { scale: 1, rotate: 0, x: 0 },
    hover: reduce || !interactive ? {} : { scale: 1.1, rotate: 3, x: 8, transition: { duration: 0.35, ease: "easeInOut" as const } },
  };
  const arrow = {
    rest: { x: 0 },
    hover: reduce ? {} : { x: 4, transition: { duration: 0.3, ease: "easeInOut" as const, repeat: Infinity, repeatType: "reverse" as const } },
  };

  const body = (
    <>
      <div className="relative z-10 flex flex-col h-full gap-2 pr-24">
        {badge && <div className="self-start">{badge}</div>}
        <h3 className="text-xl font-extrabold tracking-tight">{title}</h3>
        <p className={cn("text-sm leading-relaxed", variant === "brand" ? "text-white/85" : "text-text-muted")}>{description}</p>
        <span className={cn("mt-auto pt-3 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", interactive && "group-hover:underline")}>
          {cta}
          {interactive && (
            <motion.span variants={arrow} className="inline-flex">
              <ArrowRight className="h-4 w-4" aria-hidden />
            </motion.span>
          )}
        </span>
      </div>
      <motion.div
        variants={artMotion}
        className={cn("pointer-events-none absolute -right-6 -bottom-6 w-32 h-32 grid place-items-center", variant === "muted" ? "opacity-40" : "opacity-95")}
        aria-hidden
      >
        {art}
      </motion.div>
    </>
  );

  const classes = cn(
    "group relative flex flex-col w-full min-h-[190px] p-6 overflow-hidden rounded-xl shadow-sm transition-[box-shadow,border-color] duration-200",
    interactive && "cursor-pointer hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
    VARIANTS[variant],
    className
  );

  if (!interactive) {
    return (
      <motion.div className={classes} initial="rest" animate="rest" aria-disabled>
        {body}
      </motion.div>
    );
  }
  return (
    <motion.a href={href} className={classes} initial="rest" animate="rest" whileHover="hover" whileFocus="hover" variants={card}>
      {body}
    </motion.a>
  );
}
