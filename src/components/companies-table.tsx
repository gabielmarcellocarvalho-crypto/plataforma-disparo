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
  deal_count: number;
  created_at: string;
};

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
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
        <div className="bg-surface border border-border rounded-lg shadow-sm p-10 text-center text-text-muted">
          <p className="font-semibold text-text">Nenhuma empresa encontrada</p>
        </div>
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
                <th className="px-4 py-3">Negócios</th>
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
                  <td className="px-4 py-3 font-semibold">{c.name}</td>
                  <td className="px-4 py-3 text-text-muted">{c.domain || "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{c.phone || "—"}</td>
                  <td className="px-4 py-3 text-text-muted">{c.industry || "—"}</td>
                  <td className="px-4 py-3">{c.contact_count}</td>
                  <td className="px-4 py-3">{c.deal_count}</td>
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
