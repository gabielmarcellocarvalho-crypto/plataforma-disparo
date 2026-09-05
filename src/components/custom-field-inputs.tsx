"use client";

import { readMultiValue, type CustomFieldDef } from "@/lib/custom-fields";

const BASE_INPUT = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface w-full";

// Renderiza o input certo pro tipo do campo. Valor sai string (ou string[] no multi) — quem chama
// junta tudo e manda pro buildCustomFields, que valida antes de gravar.
export function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: unknown;
  onChange: (value: string | string[]) => void;
}) {
  const label = (
    <label className="text-xs font-semibold text-text-muted">
      {def.label}
      {def.required && <span className="text-danger"> *</span>}
    </label>
  );

  if (def.type === "selecao_multipla") {
    const selected = readMultiValue(value);
    return (
      <div className="flex flex-col gap-1">
        {label}
        <div className="border border-border rounded-md bg-surface max-h-40 overflow-y-auto flex flex-col">
          {def.options.map((opt) => (
            <label key={opt} className="flex items-center gap-2 text-sm px-2.5 py-1.5 cursor-pointer hover:bg-surface-2">
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={(e) => onChange(e.target.checked ? [...selected, opt] : selected.filter((v) => v !== opt))}
                className="cursor-pointer accent-[var(--color-primary-strong)]"
              />
              {opt}
            </label>
          ))}
          {def.options.length === 0 && <span className="text-xs text-text-muted px-2.5 py-2">Sem opções cadastradas.</span>}
        </div>
      </div>
    );
  }

  if (def.type === "selecao") {
    const current = String(value ?? "");
    // Valor gravado que não está mais na lista (a opção foi removida da definição depois) continua
    // aparecendo como opção própria — senão o select "esqueceria" o valor do lead ao ser salvo.
    const orphan = current && !def.options.includes(current) ? current : null;
    return (
      <div className="flex flex-col gap-1">
        {label}
        <select value={current} onChange={(e) => onChange(e.target.value)} className={`${BASE_INPUT} cursor-pointer`}>
          <option value="">—</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
          {orphan && <option value={orphan}>{orphan} (fora da lista)</option>}
        </select>
      </div>
    );
  }

  if (def.type === "texto_longo") {
    return (
      <div className="flex flex-col gap-1">
        {label}
        <textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} rows={3} className={`${BASE_INPUT} resize-y`} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {label}
      <input
        type={def.type === "data" ? "date" : "text"}
        inputMode={def.type === "numero" ? "decimal" : undefined}
        value={String(value ?? "")}
        onChange={(e) => onChange(e.target.value)}
        className={BASE_INPUT}
      />
    </div>
  );
}
