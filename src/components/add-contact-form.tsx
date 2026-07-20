"use client";

import { useActionState, useEffect, useRef } from "react";
import { addContact, type ActionResult } from "@/app/actions/contacts";

const INITIAL_STATE: ActionResult = { error: null };

export function AddContactForm() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(addContact, INITIAL_STATE);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md"
      >
        Adicionar contato
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-sm"
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Adicionar contato</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-semibold">
              Nome
            </label>
            <input id="name" name="name" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="phone" className="text-sm font-semibold">
              Telefone
            </label>
            <input
              id="phone"
              name="phone"
              placeholder="(11) 98888-7777"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-sm font-semibold">
              E-mail
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>

          {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}

          <div className="flex justify-end gap-2 mt-1">
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="text-sm font-semibold text-text-muted px-4 py-2.5"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md disabled:opacity-60"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
