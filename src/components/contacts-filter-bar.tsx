"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { CustomFieldDef } from "@/lib/custom-fields";
import type { BranchRow, TeamMemberRow } from "@/app/actions/team";

// Filtro de Contatos. Mora na URL (searchParams) de propósito: a lista é paginada NO SERVIDOR, então
// o filtro tem que chegar na query do banco — filtrar só a página atual no cliente daria um resultado
// mentiroso ("2 leads nessa cidade" quando existem 40, 38 deles na página 3).
export function ContactsFilterBar({
  defs,
  teamMembers,
  branches,
}: {
  defs: CustomFieldDef[];
  teamMembers: TeamMemberRow[];
  branches: BranchRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [q, setQ] = useState(params.get("q") ?? "");
  const [resp, setResp] = useState(params.get("resp") ?? "");
  const [filial, setFilial] = useState(params.get("filial") ?? "");
  const [campo, setCampo] = useState(params.get("campo") ?? "");
  const [valor, setValor] = useState(params.get("valor") ?? "");

  const selectedDef = defs.find((d) => d.key === campo);
  const hasAny = Boolean(q || resp || filial || (campo && valor));

  function apply(next?: Partial<{ q: string; resp: string; filial: string; campo: string; valor: string }>) {
    const state = { q, resp, filial, campo, valor, ...next };
    const sp = new URLSearchParams();
    if (state.q.trim()) sp.set("q", state.q.trim());
    if (state.resp) sp.set("resp", state.resp);
    if (state.filial) sp.set("filial", state.filial);
    if (state.campo && state.valor) {
      sp.set("campo", state.campo);
      sp.set("valor", state.valor);
    }
    // Tamanho de página é preferência da tela, não filtro — sobrevive. A página volta pra 1: com
    // outro filtro, "página 7" quase nunca existe mais.
    const size = params.get("size");
    if (size) sp.set("size", size);
    router.push(sp.toString() ? `/contatos?${sp}` : "/contatos");
  }

  const inputClass = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface";

  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-3 flex flex-wrap items-center gap-2.5">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
        }}
        placeholder="Buscar por nome, telefone ou e-mail…"
        className={`${inputClass} flex-1 min-w-[200px]`}
      />

      {teamMembers.length > 0 && (
        <select value={resp} onChange={(e) => { setResp(e.target.value); apply({ resp: e.target.value }); }} className={`${inputClass} cursor-pointer`}>
          <option value="">Responsável: todos</option>
          <option value="__nenhum__">Sem responsável</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      )}

      {branches.length > 0 && (
        <select value={filial} onChange={(e) => { setFilial(e.target.value); apply({ filial: e.target.value }); }} className={`${inputClass} cursor-pointer`}>
          <option value="">Filial: todas</option>
          <option value="__nenhum__">Sem filial</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}

      {defs.length > 0 && (
        <>
          <select
            value={campo}
            onChange={(e) => {
              setCampo(e.target.value);
              setValor("");
              if (!e.target.value) apply({ campo: "", valor: "" });
            }}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">Campo do lead</option>
            {defs.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>

          {selectedDef &&
            (selectedDef.options.length > 0 ? (
              <select value={valor} onChange={(e) => { setValor(e.target.value); apply({ valor: e.target.value }); }} className={`${inputClass} cursor-pointer`}>
                <option value="">valor</option>
                {selectedDef.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") apply();
                }}
                placeholder="valor"
                className={`${inputClass} w-32`}
              />
            ))}
        </>
      )}

      <button
        type="button"
        onClick={() => apply()}
        className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2 rounded-md cursor-pointer"
      >
        Filtrar
      </button>

      {hasAny && (
        <button
          type="button"
          onClick={() => {
            setQ("");
            setResp("");
            setFilial("");
            setCampo("");
            setValor("");
            apply({ q: "", resp: "", filial: "", campo: "", valor: "" });
          }}
          className="text-xs font-semibold text-text-muted hover:text-danger cursor-pointer"
        >
          limpar
        </button>
      )}
    </div>
  );
}
