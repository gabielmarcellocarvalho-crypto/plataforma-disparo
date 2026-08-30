"use client";

import { useActionState, useEffect, useRef } from "react";
import { addCompany, type ActionResult } from "@/app/actions/companies";

const INITIAL_STATE: ActionResult = { error: null };

export function AddCompanyForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(addCompany, INITIAL_STATE);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        + Empresa
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-sm"
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Adicionar empresa</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-semibold">
              Nome
            </label>
            <input id="name" name="name" required className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="domain" className="text-sm font-semibold">
              Domínio
            </label>
            <input id="domain" name="domain" placeholder="acme.com.br" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="text-sm font-semibold">
              Telefone
            </label>
            <input id="phone" name="phone" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="industry" className="text-sm font-semibold">
              Indústria
            </label>
            <input id="industry" name="industry" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm font-semibold text-text-muted px-4 py-2.5 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60 cursor-pointer"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
