import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { AddCompanyForm } from "@/components/add-company-form";
import { CompaniesTable } from "@/components/companies-table";

// Mesmo teto de "Max Rows" do Supabase que já afeta /crm e /contatos — paginar em blocos de 1000
// pra não perder empresas/contatos/negócios em workspaces grandes.
const LIMIT = 10000;
const PAGE_SIZE = 1000;

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  industry: string | null;
  created_at: string;
};

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  select: string,
  workspaceId: string
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (all.length < LIMIT) {
    const { data } = await supabase
      .from(table)
      .select(select)
      .eq("workspace_id", workspaceId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return all;
}

export default async function EmpresasPage() {
  const { workspace } = await getCurrentWorkspace();
  const supabase = await createClient();

  if (!workspace) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-extrabold tracking-tight">Empresas</h1>
      </div>
    );
  }

  const [companies, contactLinks, dealLinks] = await Promise.all([
    fetchAll<CompanyRow>(supabase, "companies", "id, name, domain, phone, industry, created_at", workspace.id),
    fetchAll<{ company_id: string | null }>(supabase, "contacts", "company_id", workspace.id),
    fetchAll<{ company_id: string | null }>(supabase, "deals", "company_id", workspace.id),
  ]);

  const contactCounts = new Map<string, number>();
  for (const { company_id } of contactLinks) {
    if (!company_id) continue;
    contactCounts.set(company_id, (contactCounts.get(company_id) || 0) + 1);
  }
  const dealCounts = new Map<string, number>();
  for (const { company_id } of dealLinks) {
    if (!company_id) continue;
    dealCounts.set(company_id, (dealCounts.get(company_id) || 0) + 1);
  }

  const rows = companies
    .map((c) => ({
      ...c,
      contact_count: contactCounts.get(c.id) || 0,
      deal_count: dealCounts.get(c.id) || 0,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Empresas</h1>
          <p className="text-text-muted text-sm mt-1">{rows.length} empresa(s) em {workspace.name}.</p>
        </div>
        <AddCompanyForm />
      </div>

      <CompaniesTable companies={rows} />
    </div>
  );
}
