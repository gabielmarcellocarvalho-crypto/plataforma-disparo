// Lista de empresas do workspace com a contagem de contatos de cada uma. Usada na visão Empresas de Contatos.
import { createClient } from "@/lib/supabase/server";

// Mesmo teto de "Max Rows" do Supabase — paginar em blocos de 1000 pra não perder empresas em workspaces grandes.
const LIMIT = 10000;
const PAGE_SIZE = 1000;

export type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  industry: string | null;
  created_at: string;
  contact_count: number;
};

async function fetchAll<T>(supabase: Awaited<ReturnType<typeof createClient>>, table: string, select: string, workspaceId: string): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (all.length < LIMIT) {
    const { data } = await supabase.from(table).select(select).eq("workspace_id", workspaceId).range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export async function loadCompanyRows(workspaceId: string): Promise<CompanyRow[]> {
  const supabase = await createClient();
  const [companies, contactLinks] = await Promise.all([
    fetchAll<Omit<CompanyRow, "contact_count">>(supabase, "companies", "id, name, domain, phone, industry, created_at", workspaceId),
    fetchAll<{ company_id: string | null }>(supabase, "contacts", "company_id", workspaceId),
  ]);
  const contactCounts = new Map<string, number>();
  for (const { company_id } of contactLinks) {
    if (company_id) contactCounts.set(company_id, (contactCounts.get(company_id) || 0) + 1);
  }
  return companies
    .map((c) => ({ ...c, contact_count: contactCounts.get(c.id) || 0 }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}
