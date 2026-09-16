"use client";

import { useState } from "react";
import { normalizeTag, MAX_TAGS_PER_CONTACT } from "@/lib/contact-tags";

// Seletor de tags usado em todo lugar que mexe com tag (novo contato, importação, campanha,
// segmentação do disparo, lead no CRM). Combina as duas formas de trabalhar: clicar numa tag que já
// existe na base — o caminho normal, e o que evita a base virar um cemitério de tags quase iguais —
// ou digitar uma nova quando ela ainda não existe.
export function TagPicker({
  value,
  onChange,
  suggestions = [],
  placeholder = "nova tag + Enter",
  disabled = false,
  compact = false,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const cheio = value.length >= MAX_TAGS_PER_CONTACT;

  function add(raw: string) {
    const tag = normalizeTag(raw);
    if (!tag || cheio) return;
    const jaTem = value.some((t) => t.toLowerCase() === tag.toLowerCase());
    if (!jaTem) onChange([...value, tag]);
    setDraft("");
  }

  function remove(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  const naoSelecionadas = suggestions.filter((s) => !value.some((t) => t.toLowerCase() === s.toLowerCase()));
  const chip = compact ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-1";

  return (
    <div className={`flex flex-col ${compact ? "gap-1" : "gap-1.5"}`}>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((tag) => (
            <span key={tag} className={`inline-flex items-center gap-1 font-bold rounded-full bg-primary-soft text-primary-strong ${chip}`}>
              {tag}
              {!disabled && (
                <button
                  type="button"
                  onClick={() => remove(tag)}
                  aria-label={`Remover tag ${tag}`}
                  className="cursor-pointer opacity-60 hover:opacity-100"
                >
                  ×
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {!disabled && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          // Enter adiciona a tag em vez de enviar o formulário — o picker vive dentro de formulários
          // (novo contato, campanha) onde submeter no meio da digitação perderia o resto do preenchimento.
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length > 0) {
              remove(value[value.length - 1]);
            }
          }}
          onBlur={() => draft.trim() && add(draft)}
          placeholder={cheio ? `Máximo de ${MAX_TAGS_PER_CONTACT} tags` : placeholder}
          disabled={cheio}
          className={`border border-border rounded-md outline-none focus:border-primary disabled:opacity-60 ${
            compact ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm"
          }`}
        />
      )}

      {!disabled && naoSelecionadas.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {naoSelecionadas.slice(0, 12).map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => add(tag)}
              className={`font-semibold rounded-full border border-border text-text-muted hover:border-primary hover:text-primary-strong cursor-pointer ${chip}`}
            >
              + {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
