"use client";

import { cn } from "@/lib/utils";

const styles = {
  switch: `relative block cursor-pointer h-8 w-[52px]
    [--c-active:var(--color-primary-strong)]
    [--c-success:var(--color-success)]
    [--c-warning:#F59E0B]
    [--c-danger:var(--color-danger)]
    [--c-default:#D2D6E9]
    [--c-default-dark:#C7CBDF]
    [transform:translateZ(0)]
    [backface-visibility:hidden]
    [perspective:1000]`,
  input: `h-full w-full cursor-pointer appearance-none rounded-full
    bg-[var(--c-default)] outline-none transition-colors duration-500
    hover:bg-[var(--c-default-dark)]
    [transform:translate3d(0,0,0)]
    data-[checked=true]:bg-[var(--c-background)]
    data-[checked=true]:hover:opacity-90`,
  svg: `pointer-events-none absolute inset-0 fill-white
    [transform:translate3d(0,0,0)]`,
  circle: `transform-gpu transition-transform duration-500
    [transform:translate3d(0,0,0)]
    [backface-visibility:hidden]`,
  dropCircle: `transform-gpu transition-transform duration-700
    [transform:translate3d(0,0,0)]`,
};

const variantStyles = {
  default: "[--c-background:var(--c-active)]",
  success: "[--c-background:var(--c-success)]",
  warning: "[--c-background:var(--c-warning)]",
  danger: "[--c-background:var(--c-danger)]",
};

type ToggleVariant = keyof typeof variantStyles;

// Switch "gooey" (as duas bolinhas se fundem via filtro SVG de blur+contraste ao trocar de lado) —
// controlado de fora (sem estado próprio), pra ficar em sincronia com o form que o usa.
export function ToggleSwitch({
  checked,
  onCheckedChange,
  className,
  variant = "default",
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  className?: string;
  variant?: ToggleVariant;
  ariaLabel?: string;
}) {
  return (
    <label className={cn(styles.switch, className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        data-checked={checked}
        aria-label={ariaLabel}
        className={cn(styles.input, variantStyles[variant])}
      />
      <svg viewBox="0 0 52 32" filter="url(#toggle-goo)" className={styles.svg} aria-hidden>
        <circle
          className={styles.circle}
          cx="16"
          cy="16"
          r="10"
          style={{
            transformOrigin: "16px 16px",
            transform: `translateX(${checked ? "12px" : "0px"}) scale(${checked ? "0" : "1"})`,
          }}
        />
        <circle
          className={styles.circle}
          cx="36"
          cy="16"
          r="10"
          style={{
            transformOrigin: "36px 16px",
            transform: `translateX(${checked ? "0px" : "-12px"}) scale(${checked ? "1" : "0"})`,
          }}
        />
        {checked && <circle className={styles.dropCircle} cx="35" cy="-1" r="2.5" />}
      </svg>
    </label>
  );
}

// Filtro compartilhado pelo efeito gooey — renderiza uma vez só na página (SVG invisível, 0x0).
export function ToggleGooeyFilter() {
  return (
    <svg className="fixed w-0 h-0" aria-hidden>
      <defs>
        <filter id="toggle-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" result="goo" />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </defs>
    </svg>
  );
}
