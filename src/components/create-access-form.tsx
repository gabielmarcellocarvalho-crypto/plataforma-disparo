"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAccess, type CreateAccessState } from "@/app/actions/access";

const INITIAL: CreateAccessState = { error: null };

export function CreateAccessForm({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<"cliente" | "colaborador">("cliente");
  const [state, formAction, pending] = useActionState(createAccess, INITIAL);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok]);

  return (
    <form ref={formRef} action={formAction} className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4 max-w-xl">
      <div>
        <h3 className="font-bold text-[15px]">Criar acesso</h3>
        <p className="text-xs text-text-muted mt-0.5">
          Cliente vê só o próprio workspace (sem custo, sem editar prompt). Colaborador é a equipe da agência e vê tudo.
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setRole("cliente")}
          className={`flex-1 text-sm font-bold rounded-md px-3 py-2 border ${role === "cliente" ? "border-primary bg-primary-faint text-primary-strong" : "border-border text-text-muted"}`}
        >
          Cliente
        </button>
        <button
          type="button"
          onClick={() => setRole("colaborador")}
          className={`flex-1 text-sm font-bold rounded-md px-3 py-2 border ${role === "colaborador" ? "border-primary bg-primary-faint text-primary-strong" : "border-border text-text-muted"}`}
        >
          Colaborador
        </button>
      </div>
      <input type="hidden" name="role" value={role} />

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold">Nome</label>
        <input name="full_name" placeholder="Nome da pessoa" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold">E-mail (login)</label>
        <input name="email" type="email" required placeholder="pessoa@email.com" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-semibold">Senha</label>
        <input name="password" type="text" required minLength={6} placeholder="mínimo 6 caracteres" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
        <span className="text-xs text-text-muted">Você repassa essa senha pra pessoa. Ela pode trocar depois.</span>
      </div>

      {role === "cliente" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Cliente (workspace)</label>
          <select name="workspace_id" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary bg-surface">
            <option value="">Selecione…</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {state.error && <p className="text-sm text-danger font-medium">{state.error}</p>}
      {state.ok && <p className="text-sm text-success font-medium">Acesso criado.</p>}

      <button
        type="submit"
        disabled={pending}
        className="bg-primary-strong text-white text-sm font-bold px-4 py-2.5 rounded-md w-fit cursor-pointer disabled:opacity-60"
      >
        {pending ? "Criando…" : "Criar acesso"}
      </button>
    </form>
  );
}
