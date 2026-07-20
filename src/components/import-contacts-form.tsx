"use client";

import { useActionState, useRef } from "react";
import { importContacts, type ImportResult } from "@/app/actions/contacts";

const INITIAL_STATE: ImportResult = { error: null };

export function ImportContactsForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(importContacts, INITIAL_STATE);

  return (
    <form ref={formRef} action={formAction} className="flex items-center gap-3">
      <label className="bg-surface border border-border text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer hover:bg-primary-faint">
        {pending ? "Importando…" : "Importar planilha"}
        <input
          type="file"
          name="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          disabled={pending}
          onChange={(e) => {
            if (e.target.files?.length) formRef.current?.requestSubmit();
          }}
        />
      </label>

      {state.error && <span className="text-sm text-danger font-medium">{state.error}</span>}
      {state.imported !== undefined && !state.error && (
        <span className="text-sm text-success font-medium">
          Importados {state.imported} de {state.total} ({state.skippedDuplicate} duplicados, {state.skippedInvalid} sem telefone/e-mail)
        </span>
      )}
    </form>
  );
}
