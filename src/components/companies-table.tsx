"use client";

import { useMemo, useState } from "react";
import { CompanyDrawer } from "@/components/company-drawer";

type CompanyListRow = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  industry: string | null;
  contact_count: number;
  created_at: string;
};

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

// Mesmo padrão de avatar-com-iniciais usado no drawer de contato (crm-lead-drawer.tsx) e no
// AgentAvatar — círculo colorido com as 2 primeiras letras, consistente em toda a plataforma.
function CompanyAvatar({ name }: { name: string }) {
  return (
    <span className="grid place-items-center w-8 h-8 rounded-full bg-primary-soft text-primary-strong text-xs font-bold shrink-0" aria-hidden>
      {name.trim().slice(0, 2).toUpperCase()}
    </span>
  );
}

function EmptyState({ hasQuery }: { hasQuery: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg shadow-sm p-10 flex flex-col items-center text-center gap-2">
      <span className="grid place-items-center w-12 h-12 rounded-full bg-primary-faint text-primary-strong" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="14" rx="1" />
          <path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
          <line x1="9" y1="12" x2="9" y2="12" />
          <line x1="15" y1="12" x2="15" y2="12" />
        </svg>
      </span>
      <p className="font-semibold text-text">{hasQuery ? "Nenhuma empresa encontrada" : "Nenhuma empresa cadastrada ainda"}</p>
      <p className="text-sm text-text-muted max-w-xs">
        {hasQuery
          ? "Tenta buscar por outro nome, domínio ou indústria."
          : "Cadastre empresas pra agrupar os contatos que trabalham nelas — clique em \"+ Empresa\" acima, ou crie direto pelo card de um contato no Pipeline."}
      </p>
    </div>
  );
}

export function CompaniesTable({ companies }: { companies: CompanyListRow[] }) {
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!search.trim()) return companies;
    const q = search.trim().toLowerCase();
    return companies.filter((c) => `${c.name} ${c.domain || ""} ${c.industry || ""}`.toLowerCase().includes(q));
  }, [companies, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-sm">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, domínio ou indústria…"
          className="w-full border border-border rounded-md pl-8 pr-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState hasQuery={Boolean(search.trim())} />
      ) : (
        <div className="bg-surface border border-border rounded-lg shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-muted text-xs font-bold uppercase">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Domínio</th>
                <th className="px-4 py-3">Telefone</th>
                <th className="px-4 py-3">Indústria</th>
                <th className="px-4 py-3">Contatos</th>
                <th className="px-4 py-3">Criado em</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => setOpenId(c.id)}
                  className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-2 transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <CompanyAvatar name={c.name} />
                      <span className="font-semibold">{c.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted">{c.domain || "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{c.phone || "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{c.industry || "—"}</td>
                  <td className="px-4 py-3">
                    {c.contact_count > 0 ? (
                      <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary-faint text-primary-strong">{c.contact_count}</span>
                    ) : (
                      <span className="text-text-muted">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-muted">{formatDateShort(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CompanyDrawer companyId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}
