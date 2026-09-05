"use client";

import { useState, useTransition } from "react";
import {
  createCustomFieldDef,
  updateCustomFieldDef,
  deleteCustomFieldDef,
  reorderCustomFieldDefs,
} from "@/app/actions/custom-fields";
import { CUSTOM_FIELD_TYPES, normalizeFieldKey, type CustomFieldDef, type CustomFieldType } from "@/lib/custom-fields";

type Draft = {
  label: string;
  type: CustomFieldType;
  optionsText: string;
  required: boolean;
  showInTable: boolean;
  showInCard: boolean;
};

const EMPTY_DRAFT: Draft = { label: "", type: "texto", optionsText: "", required: false, showInTable: true, showInCard: false };

function draftFrom(def: CustomFieldDef): Draft {
  return {
    label: def.label,
    type: def.type,
    optionsText: def.options.join("\n"),
    required: def.required,
    showInTable: def.show_in_table,
    showInCard: def.show_in_card,
  };
}

function typeLabel(type: CustomFieldType) {
  return CUSTOM_FIELD_TYPES.find((t) => t.key === type)?.label ?? type;
}

function FieldForm({
  draft,
  setDraft,
  isNew,
  existingKey,
  pending,
  onSubmit,
  onCancel,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  isNew: boolean;
  existingKey?: string;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const needsOptions = draft.type === "selecao" || draft.type === "selecao_multipla";
  const key = existingKey ?? normalizeFieldKey(draft.label);

  return (
    <div className="border border-primary-soft bg-primary-faint/40 rounded-lg p-3 flex flex-col gap-3">
      <div className="grid sm:grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">Nome do campo</label>
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="ex.: Produto de interesse"
            className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface"
          />
          {key && (
            <span className="text-[11px] text-text-muted font-mono">
              chave: {key}
              {!isNew && " (não muda — é o vínculo com o que já foi preenchido)"}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">Tipo</label>
          <select
            value={draft.type}
            onChange={(e) => setDraft({ ...draft, type: e.target.value as CustomFieldType })}
            className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface cursor-pointer"
          >
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
          <span className="text-[11px] text-text-muted">{CUSTOM_FIELD_TYPES.find((t) => t.key === draft.type)?.hint}</span>
        </div>
      </div>

      {needsOptions && (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-text-muted">Opções — uma por linha</label>
          <textarea
            value={draft.optionsText}
            onChange={(e) => setDraft({ ...draft, optionsText: e.target.value })}
            rows={5}
            placeholder={"Trator\nPeça\nImplemento\nConsórcio"}
            className="border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface resize-y font-mono"
          />
          <span className="text-[11px] text-text-muted">
            Tirar uma opção daqui não apaga o valor dos leads que já estavam com ela — só some da lista pros próximos.
          </span>
        </div>
      )}

      <div className="flex items-center gap-4 flex-wrap">
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
            className="cursor-pointer accent-[var(--color-primary-strong)]"
          />
          Obrigatório
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={draft.showInTable}
            onChange={(e) => setDraft({ ...draft, showInTable: e.target.checked })}
            className="cursor-pointer accent-[var(--color-primary-strong)]"
          />
          Coluna em Contatos
        </label>
        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
          <input
            type="checkbox"
            checked={draft.showInCard}
            onChange={(e) => setDraft({ ...draft, showInCard: e.target.checked })}
            className="cursor-pointer accent-[var(--color-primary-strong)]"
          />
          Etiqueta no card
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || !draft.label.trim()}
          className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2 rounded-md cursor-pointer disabled:opacity-60"
        >
          {isNew ? "Criar campo" : "Salvar campo"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-2">
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function CustomFieldsEditor({
  defs: initialDefs,
  onChanged,
  onClose,
}: {
  defs: CustomFieldDef[];
  onChanged: (defs: CustomFieldDef[]) => void;
  onClose: () => void;
}) {
  const [defs, setDefs] = useState(initialDefs);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function publish(next: CustomFieldDef[]) {
    setDefs(next);
    onChanged(next);
  }

  function optionsFromDraft() {
    return draft.optionsText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }

  function handleCreate() {
    setError(null);
    const input = {
      label: draft.label,
      type: draft.type,
      options: optionsFromDraft(),
      required: draft.required,
      showInTable: draft.showInTable,
      showInCard: draft.showInCard,
    };
    startTransition(async () => {
      const result = await createCustomFieldDef(input);
      if (result.error || !result.id) {
        setError(result.error || "Não foi possível criar o campo.");
        return;
      }
      publish([
        ...defs,
        {
          id: result.id,
          key: normalizeFieldKey(input.label),
          label: input.label.trim(),
          type: input.type,
          options: input.options,
          required: input.required,
          show_in_table: input.showInTable,
          show_in_card: input.showInCard,
          position: defs.length,
        },
      ]);
      setCreating(false);
      setDraft(EMPTY_DRAFT);
    });
  }

  function handleUpdate(id: string) {
    setError(null);
    const input = {
      label: draft.label,
      type: draft.type,
      options: optionsFromDraft(),
      required: draft.required,
      showInTable: draft.showInTable,
      showInCard: draft.showInCard,
    };
    startTransition(async () => {
      const result = await updateCustomFieldDef(id, input);
      if (result.error) {
        setError(result.error);
        return;
      }
      publish(
        defs.map((d) =>
          d.id === id
            ? {
                ...d,
                label: input.label.trim(),
                type: input.type,
                options: input.options,
                required: input.required,
                show_in_table: input.showInTable,
                show_in_card: input.showInCard,
              }
            : d
        )
      );
      setEditingId(null);
      setDraft(EMPTY_DRAFT);
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteCustomFieldDef(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      publish(defs.filter((d) => d.id !== id));
      setConfirmDeleteId(null);
    });
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= defs.length) return;
    const next = [...defs];
    [next[index], next[target]] = [next[target], next[index]];
    publish(next.map((d, i) => ({ ...d, position: i })));
    startTransition(async () => {
      await reorderCustomFieldDefs(next.map((d) => d.id));
    });
  }

  return (
    <div className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3 shrink-0">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold">Campos do lead</h3>
          <p className="text-xs text-text-muted mt-0.5">
            O que você criar aqui aparece em todo lead: no painel do card, como coluna em Contatos e como filtro do
            Pipeline. Lista com opções fixas é o que faz o relatório somar certo — em texto livre cada um digita de um
            jeito.
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-text-muted hover:text-text cursor-pointer p-1 shrink-0">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
      </div>

      {defs.length === 0 && !creating && <p className="text-xs text-text-muted">Nenhum campo criado ainda.</p>}

      <div className="flex flex-col gap-1.5">
        {defs.map((def, i) =>
          editingId === def.id ? (
            <FieldForm
              key={def.id}
              draft={draft}
              setDraft={setDraft}
              isNew={false}
              existingKey={def.key}
              pending={pending}
              onSubmit={() => handleUpdate(def.id)}
              onCancel={() => {
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
              }}
            />
          ) : (
            <div key={def.id} className="flex items-center gap-2 border border-border rounded-lg px-3 py-2 bg-surface-2">
              <div className="flex flex-col shrink-0">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Subir" className="text-text-muted hover:text-primary-strong disabled:opacity-25 cursor-pointer leading-none text-[10px]">
                  ▲
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === defs.length - 1} aria-label="Descer" className="text-text-muted hover:text-primary-strong disabled:opacity-25 cursor-pointer leading-none text-[10px]">
                  ▼
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold truncate">{def.label}</span>
                  {def.required && <span className="text-[10px] font-bold text-danger">obrigatório</span>}
                </div>
                <div className="text-[11px] text-text-muted flex items-center gap-2 flex-wrap">
                  <span>{typeLabel(def.type)}</span>
                  {def.options.length > 0 && <span>· {def.options.length} opções</span>}
                  {def.show_in_table && <span>· coluna</span>}
                  {def.show_in_card && <span>· card</span>}
                  <span className="font-mono opacity-70">· {def.key}</span>
                </div>
              </div>

              {confirmDeleteId === def.id ? (
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] text-text-muted">Some do formulário; o que já foi preenchido fica.</span>
                  <button type="button" onClick={() => handleDelete(def.id)} disabled={pending} className="text-[11px] font-bold text-white bg-danger px-2.5 py-1 rounded-md cursor-pointer disabled:opacity-60">
                    Remover
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className="text-[11px] font-semibold text-text-muted cursor-pointer">
                    Cancelar
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setCreating(false);
                      setEditingId(def.id);
                      setDraft(draftFrom(def));
                    }}
                    className="text-[11px] font-bold text-primary-strong hover:underline cursor-pointer"
                  >
                    editar
                  </button>
                  <button type="button" onClick={() => setConfirmDeleteId(def.id)} className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer">
                    remover
                  </button>
                </div>
              )}
            </div>
          )
        )}
      </div>

      {creating ? (
        <FieldForm
          draft={draft}
          setDraft={setDraft}
          isNew
          pending={pending}
          onSubmit={handleCreate}
          onCancel={() => {
            setCreating(false);
            setDraft(EMPTY_DRAFT);
          }}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setCreating(true);
          }}
          className="self-start text-xs font-bold text-primary-strong hover:underline cursor-pointer"
        >
          + novo campo
        </button>
      )}

      {error && <span className="text-xs text-danger font-medium">{error}</span>}
    </div>
  );
}
