"use client";

import { useEffect, useState } from "react";
import { listApprovedTemplatesForWorkflow, type ApprovedTemplateOption } from "@/app/actions/templates";
import type { SendMode, SendTemplate } from "@/lib/workflow-types";
import { previewText, type TemplateField } from "@/lib/template-variables";
import { cn } from "@/lib/utils";

export type SendConfig = { mode?: SendMode; text: string; template?: SendTemplate | null };

// Passo "Enviar mensagem (WhatsApp)": escolhe entre texto livre (só dentro das 24h do lead) e template aprovado
// (vale a qualquer momento). No template, cada variável é ligada a um campo da lista de contatos deste workspace.
// lockTemplate: só template (ex.: follow-up do agente em número oficial), sem a escolha de texto livre.
export function WorkflowSendConfig({
  config,
  onChange,
  textPlaceholder,
  lockTemplate = false,
}: {
  config: SendConfig;
  onChange: (next: SendConfig) => void;
  textPlaceholder: string;
  lockTemplate?: boolean;
}) {
  const mode: SendMode = lockTemplate ? "template" : config.mode ?? "free";
  const [options, setOptions] = useState<{ templates: ApprovedTemplateOption[]; fields: TemplateField[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "template") return;
    let alive = true;
    listApprovedTemplatesForWorkflow().then((r) => {
      if (!alive) return;
      if (r.error !== null) setLoadError(r.error);
      else setOptions({ templates: r.templates, fields: r.fields });
    });
    return () => {
      alive = false;
    };
  }, [mode]);

  const selected = options?.templates.find((t) => t.name === config.template?.name && t.language === config.template?.language) ?? null;

  function pickTemplate(key: string) {
    const [name, language] = key.split("|");
    const t = options?.templates.find((x) => x.name === name && x.language === language);
    if (!t) return;
    // Começa com o campo que já foi salvo pro template; quem configura pode trocar.
    const variables = Array.from({ length: t.variableCount }, (_, i) => t.variables[i] || "");
    onChange({ ...config, template: { name: t.name, language: t.language, category: t.category, variables } });
  }

  function setVariable(i: number, field: string) {
    if (!config.template) return;
    const variables = [...config.template.variables];
    variables[i] = field;
    onChange({ ...config, template: { ...config.template, variables } });
  }

  return (
    <div className="flex flex-col gap-2.5">
      {!lockTemplate && (
      <div className="grid grid-cols-2 gap-1.5">
        {([
          { key: "free", label: "Texto livre", hint: "Só vai se o lead falou nas últimas 24h" },
          { key: "template", label: "Template aprovado", hint: "Vale a qualquer momento, até depois de 24h" },
        ] as { key: SendMode; label: string; hint: string }[]).map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange({ ...config, mode: opt.key })}
            aria-pressed={mode === opt.key}
            className={cn(
              "text-left rounded-md border px-2.5 py-2 cursor-pointer",
              mode === opt.key ? "border-primary-strong bg-primary-faint" : "border-border hover:bg-bg"
            )}
          >
            <span className="block text-xs font-bold">{opt.label}</span>
            <span className="block text-[11px] text-text-muted">{opt.hint}</span>
          </button>
        ))}
      </div>
      )}

      {mode === "free" && (
        <textarea
          value={config.text}
          onChange={(e) => onChange({ ...config, text: e.target.value })}
          placeholder={textPlaceholder}
          rows={2}
          className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface resize-none"
        />
      )}

      {mode === "template" && (
        <div className="flex flex-col gap-2.5">
          {loadError && <p className="text-xs text-danger font-medium">{loadError}</p>}
          {!options && !loadError && <p className="text-xs text-text-muted">Carregando templates aprovados…</p>}
          {options && options.templates.length === 0 && (
            <p className="text-xs text-text-muted">Nenhum template aprovado ainda. Crie e aguarde a aprovação da Meta em Automação → Templates.</p>
          )}
          {options && options.templates.length > 0 && (
            <>
              <select
                value={selected ? `${selected.name}|${selected.language}` : ""}
                onChange={(e) => pickTemplate(e.target.value)}
                className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface cursor-pointer"
              >
                <option value="">Escolha um template…</option>
                {options.templates.map((t) => (
                  <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                    {t.name} ({t.category === "UTILITY" ? "utilidade" : t.category === "MARKETING" ? "marketing" : t.category.toLowerCase()})
                  </option>
                ))}
              </select>

              {selected && config.template && selected.variableCount > 0 && (
                <div className="flex flex-col gap-2">
                  {Array.from({ length: selected.variableCount }, (_, i) => (
                    <label key={i} className="flex flex-col gap-1 text-xs font-semibold">
                      {`{{${i + 1}}}`} vem do campo
                      <select
                        value={config.template?.variables[i] || ""}
                        onChange={(e) => setVariable(i, e.target.value)}
                        className="border border-border rounded-md px-2.5 py-1.5 text-sm font-normal outline-none focus:border-primary bg-surface cursor-pointer"
                      >
                        <option value="">Escolha um campo…</option>
                        {options.fields.map((f) => (
                          <option key={f.value} value={f.value}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}

              {selected && (
                <p className="text-xs text-text-muted whitespace-pre-wrap rounded-md bg-bg p-2.5">
                  {options && config.template
                    ? previewText(selected.bodyText, config.template.variables, options.fields)
                    : selected.bodyText}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
