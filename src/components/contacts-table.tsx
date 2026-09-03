"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteContacts } from "@/app/actions/contacts";

export type ContactRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opt_out_whatsapp: boolean | null;
  opt_out_email: boolean | null;
};

// Checkbox do cabeçalho: marcado quando a página inteira está selecionada, "traço" (indeterminate)
// quando só parte dela está. `indeterminate` só existe via DOM, não como atributo do React.
function HeaderCheckbox({ checked, indeterminate, onChange }: { checked: boolean; indeterminate: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      aria-label="Selecionar todos desta página"
      className="cursor-pointer accent-[var(--color-primary-strong)]"
    />
  );
}

export function ContactsTable({ rows }: { rows: ContactRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Trocar de página (ou de tamanho de página) traz outra lista — a seleção antiga não vale mais,
  // e manter ids invisíveis marcados é exatamente como se apaga contato sem querer.
  useEffect(() => {
    setSelected(new Set());
    setConfirming(false);
    setError(null);
  }, [rows]);

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setConfirming(false);
  }

  function toggleAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));
    setConfirming(false);
  }

  function handleDelete() {
    setError(null);
    const ids = Array.from(selected);
    startTransition(async () => {
      const result = await deleteContacts(ids);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSelected(new Set());
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3 bg-danger-soft border border-danger/30 rounded-lg px-4 py-3">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-danger">
              {selected.size} contato{selected.size > 1 ? "s" : ""} selecionado{selected.size > 1 ? "s" : ""}
            </span>
            {confirming && (
              <span className="text-xs text-danger/80 mt-0.5">
                Apaga o contato de vez: some do Pipeline, das Conversas (com o histórico de mensagens), das
                Empresas, da fila das campanhas e as tarefas dele vão junto. Não dá pra desfazer.
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {!confirming ? (
              <>
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-1.5"
                >
                  Limpar seleção
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="text-xs font-bold text-white bg-danger px-3 py-1.5 rounded-md cursor-pointer"
                >
                  Excluir selecionados
                </button>
              </>
            ) : (
              <>
                <span className="text-xs font-bold text-danger">Tem certeza?</span>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  disabled={pending}
                  className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-1.5 disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={pending}
                  className="text-xs font-bold text-white bg-danger px-3 py-1.5 rounded-md cursor-pointer disabled:opacity-60"
                >
                  {pending ? "Excluindo…" : `Sim, excluir ${selected.size}`}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-danger font-medium">{error}</p>}

      <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
              <th className="pl-4 pr-1 py-3 w-8">
                <HeaderCheckbox
                  checked={allOnPageSelected}
                  indeterminate={selected.size > 0 && !allOnPageSelected}
                  onChange={toggleAll}
                />
              </th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Telefone</th>
              <th className="px-4 py-3">E-mail</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const checked = selected.has(c.id);
              return (
                <tr
                  key={c.id}
                  onClick={() => toggle(c.id)}
                  className={`border-b border-border last:border-0 cursor-pointer ${checked ? "bg-primary-faint" : "hover:bg-bg"}`}
                >
                  <td className="pl-4 pr-1 py-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Selecionar ${c.name || c.phone || c.email || "contato"}`}
                      className="cursor-pointer accent-[var(--color-primary-strong)]"
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold">{c.name || "—"}</td>
                  <td className="px-4 py-3">{c.phone || "—"}</td>
                  <td className="px-4 py-3">{c.email || "—"}</td>
                  <td className="px-4 py-3">
                    {c.opt_out_whatsapp || c.opt_out_email ? (
                      <span className="text-danger font-semibold text-xs">opt-out</span>
                    ) : (
                      <span className="text-success font-semibold text-xs">ativo</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
