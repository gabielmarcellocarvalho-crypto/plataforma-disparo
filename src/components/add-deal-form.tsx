"use client";

import { useActionState, useEffect, useRef } from "react";
import { addDeal, type ActionResult } from "@/app/actions/deals";
import type { DealStage } from "@/lib/deal-stages";

const INITIAL_STATE: ActionResult = { error: null };

export function AddDealForm({ stages }: { stages: DealStage[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction, pending] = useActionState(addDeal, INITIAL_STATE);

  useEffect(() => {
    if (state.ok) dialogRef.current?.close();
  }, [state.ok]);

  return (
    <>
      <button
        onClick={() => dialogRef.current?.showModal()}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md cursor-pointer"
      >
        + Negócio
      </button>

      <dialog
        ref={dialogRef}
        className="rounded-lg border border-border shadow-md p-0 backdrop:bg-black/40 w-full max-w-sm"
      >
        <form action={formAction} className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-extrabold">Adicionar negócio</h2>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="name" className="text-sm font-semibold">
              Nome
            </label>
            <input id="name" name="name" required className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="amount" className="text-sm font-semibold">
              Valor (R$)
            </label>
            <input id="amount" name="amount" placeholder="5000" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="stageId" className="text-sm font-semibold">
              Estágio inicial
            </label>
            <select id="stageId" name="stageId" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary bg-surface cursor-pointer">
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
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
