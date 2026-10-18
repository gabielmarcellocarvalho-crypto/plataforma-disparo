"use client";

import { useEffect, useState } from "react";
import { Bot, Code2, Image as ImageIcon, Layers, Mail, MessageCircle, ToggleRight, type LucideIcon } from "lucide-react";

const ICONS: Record<string, LucideIcon> = { toggle: ToggleRight, plan: Layers, whatsapp: MessageCircle, bot: Bot, mail: Mail, image: ImageIcon, code: Code2 };

export type NavSection = { id: string; label: string; hint?: string; icon?: string; content: React.ReactNode };

// Página longa dividida em seções com navegação lateral (estilo configurações do HubSpot): só a seção
// escolhida aparece. A seção atual vai pro ?secao= da URL, pra dar pra mandar o link direto pra ela e
// pra voltar nela depois de um reload.
export function SectionNav({ sections, param = "secao", layout = "side" }: { sections: NavSection[]; param?: string; layout?: "side" | "tabs" }) {
  const [current, setCurrent] = useState(sections[0]?.id ?? "");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get(param);
    if (fromUrl && sections.some((s) => s.id === fromUrl)) setCurrent(fromUrl);
  }, [param, sections]);

  function select(id: string) {
    setCurrent(id);
    const url = new URL(window.location.href);
    url.searchParams.set(param, id);
    window.history.replaceState(null, "", url);
  }

  const active = sections.find((s) => s.id === current) ?? sections[0];
  if (!active) return null;

  if (layout === "tabs") {
    return (
      <div className="flex flex-col gap-5">
        <nav aria-label="Abas" className="flex gap-1 border-b border-border overflow-x-auto">
          {sections.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => select(s.id)}
              aria-current={s.id === active.id ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-bold whitespace-nowrap cursor-pointer ${
                s.id === active.id ? "border-primary-strong text-text" : "border-transparent text-text-muted hover:text-text"
              }`}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="flex flex-col gap-6">{active.content}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-start">
      <nav aria-label="Seções" className="w-full lg:w-56 shrink-0 lg:sticky lg:top-0">
        {/* No celular vira um seletor: a lista lateral não cabe ao lado do conteúdo. */}
        <select
          value={active.id}
          onChange={(e) => select(e.target.value)}
          className="lg:hidden w-full border border-border rounded-md px-3 py-2 text-sm bg-surface outline-none focus:border-primary"
          aria-label="Seção"
        >
          {sections.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>
        <ul className="hidden lg:flex flex-col gap-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => select(s.id)}
                aria-current={s.id === active.id ? "page" : undefined}
                className={`w-full flex items-center gap-2.5 text-left rounded-md px-3 py-2 text-sm font-semibold cursor-pointer transition-colors ${
                  s.id === active.id ? "bg-surface shadow-sm text-text" : "text-text-muted hover:bg-surface hover:text-text"
                }`}
              >
                {s.icon && ICONS[s.icon] ? (() => {
                  const Icon = ICONS[s.icon!];
                  return <Icon size={15} className={s.id === active.id ? "text-primary-strong" : ""} aria-hidden />;
                })() : null}
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className="flex-1 min-w-0 flex flex-col gap-5">{active.content}</div>
    </div>
  );
}
