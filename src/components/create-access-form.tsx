"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createAccess, type CreateAccessState } from "@/app/actions/access";
import { ACCESS_TYPES, type AccessType } from "@/lib/access-types";

const INITIAL: CreateAccessState = { error: null };

const ROLE_OPTIONS = [
  { key: "cliente" as const, label: "Cliente", description: "Vê só o workspace dele, sem custo/margem, páginas limitadas pelo plano." },
  { key: "colaborador" as const, label: "Colaborador", description: "Acesso completo (agentes, custo, config), mas só nos workspace(s) que você escolher abaixo." },
  { key: "developer" as const, label: "Developer", description: "Acesso total — enxerga e opera todos os workspaces, cria/remove cliente, mexe em Acessos/Calculadora." },
];

export function CreateAccessForm({ workspaces }: { workspaces: { id: string; name: string }[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [role, setRole] = useState<"cliente" | "colaborador" | "developer">("cliente");
  const [accessType, setAccessType] = useState<AccessType | "">("");
  const [state, formAction, pending] = useActionState(createAccess, INITIAL);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setAccessType("");
    }
  }, [state.ok]);

  const needsWorkspace = role === "cliente" || role === "colaborador";

  return (
    <form ref={formRef} action={formAction} className="bg-surface border border-border rounded-lg shadow-sm p-5 flex flex-col gap-4 max-w-xl">
      <div>
        <h3 className="font-bold text-[15px]">Criar acesso</h3>
        <p className="text-xs text-text-muted mt-0.5">{ROLE_OPTIONS.find((o) => o.key === role)?.description}</p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {ROLE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setRole(opt.key)}
            className={`text-sm font-bold rounded-md px-3 py-2 border ${role === opt.key ? "border-primary bg-primary-faint text-primary-strong" : "border-border text-text-muted"}`}
          >
            {opt.label}
          </button>
        ))}
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
        <input name="password" type="text" required minLength={10} placeholder="mínimo 10 caracteres" className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary" />
        <span className="text-xs text-text-muted">Você repassa essa senha pra pessoa. Ela pode trocar depois.</span>
      </div>

      {needsWorkspace && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Workspace</label>
          {role === "colaborador" && (
            <p className="text-xs text-text-muted -mt-0.5">Colaborador só vai enxergar esse workspace — pra dar acesso a mais de um, crie um acesso por vez.</p>
          )}
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

      {role === "cliente" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-semibold">Plano / tipo de acesso</label>
          <p className="text-xs text-text-muted -mt-0.5">Define quais páginas do menu essa pessoa vê.</p>
          <select
            name="access_type"
            value={accessType}
            onChange={(e) => setAccessType(e.target.value as AccessType)}
            required
            className="border border-border rounded-md px-3 py-2.5 text-sm outline-none focus:border-primary bg-surface"
          >
            <option value="">Selecione…</option>
            {ACCESS_TYPES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
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
