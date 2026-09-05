"use client";

import { useMemo, useState, useTransition } from "react";
import { saveBranch, deleteBranch, saveTeamMember, deleteTeamMember, type BranchRow, type TeamMemberRow } from "@/app/actions/team";

const INPUT = "border border-border rounded-md px-2.5 py-2 text-sm outline-none focus:border-primary bg-surface";

type BranchDraft = { name: string; city: string; phone: string };
type MemberDraft = { name: string; role: string; branchId: string; phone: string; email: string; active: boolean };

const EMPTY_BRANCH: BranchDraft = { name: "", city: "", phone: "" };
const EMPTY_MEMBER: MemberDraft = { name: "", role: "", branchId: "", phone: "", email: "", active: true };

export function TeamManager({ branches: initialBranches, members: initialMembers }: { branches: BranchRow[]; members: TeamMemberRow[] }) {
  const [branches, setBranches] = useState(initialBranches);
  const [members, setMembers] = useState(initialMembers);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [branchDraft, setBranchDraft] = useState<BranchDraft>(EMPTY_BRANCH);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);

  const [memberDraft, setMemberDraft] = useState<MemberDraft>(EMPTY_MEMBER);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [branchFilter, setBranchFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const branchNameById = useMemo(() => new Map(branches.map((b) => [b.id, b.name])), [branches]);
  const visibleMembers = useMemo(
    () =>
      members.filter((m) => {
        if (!showInactive && !m.active) return false;
        if (branchFilter === "__nenhum__") return !m.branch_id;
        if (branchFilter) return m.branch_id === branchFilter;
        return true;
      }),
    [members, branchFilter, showInactive]
  );

  // ── Filiais ─────────────────────────────────────────────────────────────
  function submitBranch() {
    setError(null);
    const draft = branchDraft;
    const id = editingBranchId;
    startTransition(async () => {
      const result = await saveBranch(id, draft);
      if (result.error || !result.id) {
        setError(result.error || "Não foi possível salvar.");
        return;
      }
      setBranches((prev) =>
        id
          ? prev.map((b) => (b.id === id ? { ...b, name: draft.name.trim(), city: draft.city.trim() || null, phone: draft.phone.trim() || null } : b))
          : [
              ...prev,
              { id: result.id!, name: draft.name.trim(), city: draft.city.trim() || null, phone: draft.phone.trim() || null, position: prev.length },
            ]
      );
      setBranchDraft(EMPTY_BRANCH);
      setEditingBranchId(null);
    });
  }

  function removeBranch(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteBranch(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setBranches((prev) => prev.filter((b) => b.id !== id));
      setMembers((prev) => prev.map((m) => (m.branch_id === id ? { ...m, branch_id: null } : m)));
    });
  }

  // ── Pessoas ─────────────────────────────────────────────────────────────
  function submitMember() {
    setError(null);
    const draft = memberDraft;
    const id = editingMemberId;
    startTransition(async () => {
      const result = await saveTeamMember(id, draft);
      if (result.error || !result.id) {
        setError(result.error || "Não foi possível salvar.");
        return;
      }
      const row: TeamMemberRow = {
        id: result.id,
        name: draft.name.trim(),
        role: draft.role.trim() || null,
        branch_id: draft.branchId || null,
        phone: draft.phone.trim() || null,
        email: draft.email.trim() || null,
        active: draft.active,
      };
      setMembers((prev) => (id ? prev.map((m) => (m.id === id ? row : m)) : [...prev, row]));
      setMemberDraft(EMPTY_MEMBER);
      setEditingMemberId(null);
    });
  }

  function removeMember(id: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteTeamMember(id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers((prev) => prev.filter((m) => m.id !== id));
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-danger font-medium">{error}</p>}

      <section className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-bold">Filiais</h2>
          <p className="text-xs text-text-muted mt-0.5">
            Onde o lead é atendido. Remover uma filial não apaga lead nem pessoa — os dois só ficam sem filial.
          </p>
        </div>

        {branches.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center gap-3 border border-border rounded-lg px-3 py-2 bg-surface-2">
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold">{b.name}</span>
                  <div className="text-[11px] text-text-muted flex items-center gap-2 flex-wrap">
                    {b.city && <span>{b.city}</span>}
                    {b.phone && <span>· {b.phone}</span>}
                    <span>· {members.filter((m) => m.branch_id === b.id).length} pessoa(s)</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditingBranchId(b.id);
                    setBranchDraft({ name: b.name, city: b.city || "", phone: b.phone || "" });
                  }}
                  className="text-[11px] font-bold text-primary-strong hover:underline cursor-pointer shrink-0"
                >
                  editar
                </button>
                <button
                  type="button"
                  onClick={() => removeBranch(b.id)}
                  disabled={pending}
                  className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer shrink-0 disabled:opacity-50"
                >
                  remover
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2.5 border-t border-border pt-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs font-semibold text-text-muted">Nome da filial</label>
            <input value={branchDraft.name} onChange={(e) => setBranchDraft({ ...branchDraft, name: e.target.value })} placeholder="ex.: Lavras" className={INPUT} />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-xs font-semibold text-text-muted">Cidade</label>
            <input value={branchDraft.city} onChange={(e) => setBranchDraft({ ...branchDraft, city: e.target.value })} className={INPUT} />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
            <label className="text-xs font-semibold text-text-muted">Telefone</label>
            <input value={branchDraft.phone} onChange={(e) => setBranchDraft({ ...branchDraft, phone: e.target.value })} className={INPUT} />
          </div>
          <button
            type="button"
            onClick={submitBranch}
            disabled={pending || !branchDraft.name.trim()}
            className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2.5 rounded-md cursor-pointer disabled:opacity-60"
          >
            {editingBranchId ? "Salvar filial" : "+ Filial"}
          </button>
          {editingBranchId && (
            <button
              type="button"
              onClick={() => {
                setEditingBranchId(null);
                setBranchDraft(EMPTY_BRANCH);
              }}
              className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-2.5"
            >
              Cancelar
            </button>
          )}
        </div>
      </section>

      <section className="bg-surface border border-border rounded-xl shadow-sm p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-bold">Pessoas</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Quem pode ficar responsável por um lead. Não é conta de acesso — cadastrar alguém aqui não cria login
              nem dá acesso à plataforma.
            </p>
          </div>
          <div className="flex items-center gap-2.5">
            {branches.length > 0 && (
              <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={`${INPUT} cursor-pointer`}>
                <option value="">Todas as filiais</option>
                <option value="__nenhum__">Sem filial</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="cursor-pointer accent-[var(--color-primary-strong)]" />
              mostrar inativos
            </label>
          </div>
        </div>

        {visibleMembers.length === 0 ? (
          <p className="text-xs text-text-muted">Ninguém cadastrado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Função</th>
                  <th className="px-3 py-2">Filial</th>
                  <th className="px-3 py-2">Telefone</th>
                  <th className="px-3 py-2">E-mail</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((m) => (
                  <tr key={m.id} className={`border-b border-border last:border-0 ${m.active ? "" : "opacity-55"}`}>
                    <td className="px-3 py-2 font-semibold">
                      {m.name}
                      {!m.active && <span className="text-[10px] font-bold text-text-muted ml-1.5">inativo</span>}
                    </td>
                    <td className="px-3 py-2">{m.role || "—"}</td>
                    <td className="px-3 py-2">{(m.branch_id && branchNameById.get(m.branch_id)) || "—"}</td>
                    <td className="px-3 py-2">{m.phone || "—"}</td>
                    <td className="px-3 py-2">{m.email || "—"}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingMemberId(m.id);
                          setMemberDraft({
                            name: m.name,
                            role: m.role || "",
                            branchId: m.branch_id || "",
                            phone: m.phone || "",
                            email: m.email || "",
                            active: m.active,
                          });
                        }}
                        className="text-[11px] font-bold text-primary-strong hover:underline cursor-pointer"
                      >
                        editar
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={pending}
                        className="text-[11px] font-bold text-text-muted hover:text-danger cursor-pointer ml-3 disabled:opacity-50"
                      >
                        remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2.5 border-t border-border pt-3">
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs font-semibold text-text-muted">Nome</label>
            <input value={memberDraft.name} onChange={(e) => setMemberDraft({ ...memberDraft, name: e.target.value })} className={INPUT} />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
            <label className="text-xs font-semibold text-text-muted">Função</label>
            <input value={memberDraft.role} onChange={(e) => setMemberDraft({ ...memberDraft, role: e.target.value })} placeholder="ex.: Vendedor" className={INPUT} />
          </div>
          <div className="flex flex-col gap-1 min-w-[140px]">
            <label className="text-xs font-semibold text-text-muted">Filial</label>
            <select value={memberDraft.branchId} onChange={(e) => setMemberDraft({ ...memberDraft, branchId: e.target.value })} className={`${INPUT} cursor-pointer`}>
              <option value="">— sem filial</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[130px]">
            <label className="text-xs font-semibold text-text-muted">Telefone</label>
            <input value={memberDraft.phone} onChange={(e) => setMemberDraft({ ...memberDraft, phone: e.target.value })} className={INPUT} />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[160px]">
            <label className="text-xs font-semibold text-text-muted">E-mail</label>
            <input value={memberDraft.email} onChange={(e) => setMemberDraft({ ...memberDraft, email: e.target.value })} className={INPUT} />
          </div>
          <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer py-2.5">
            <input
              type="checkbox"
              checked={memberDraft.active}
              onChange={(e) => setMemberDraft({ ...memberDraft, active: e.target.checked })}
              className="cursor-pointer accent-[var(--color-primary-strong)]"
            />
            ativo
          </label>
          <button
            type="button"
            onClick={submitMember}
            disabled={pending || !memberDraft.name.trim()}
            className="bg-primary-strong text-white text-xs font-bold px-3.5 py-2.5 rounded-md cursor-pointer disabled:opacity-60"
          >
            {editingMemberId ? "Salvar pessoa" : "+ Pessoa"}
          </button>
          {editingMemberId && (
            <button
              type="button"
              onClick={() => {
                setEditingMemberId(null);
                setMemberDraft(EMPTY_MEMBER);
              }}
              className="text-xs font-semibold text-text-muted hover:text-text cursor-pointer px-2 py-2.5"
            >
              Cancelar
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
