"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, getCurrentUserName } from "@/lib/workspace";

export type ActionResult = { error: string | null; ok?: boolean };

// Normaliza domínio pra dedupe (lowercase, sem protocolo/www/caminho) — "https://www.acme.com.br/sobre"
// vira "acme.com.br". Entrada vazia/whitespace vira null (coluna é opcional).
function normalizeDomain(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .trim() || null;
}

export type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  industry: string | null;
  custom_fields: Record<string, unknown> | null;
  created_at: string;
};

export async function addCompany(_prevState: ActionResult, formData: FormData): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = String(formData.get("name") || "").trim();
  if (!name) return { error: "Informe o nome da empresa." };

  const domain = normalizeDomain(String(formData.get("domain") || ""));
  const website = String(formData.get("website") || "").trim() || null;
  const phone = String(formData.get("phone") || "").trim() || null;
  const industry = String(formData.get("industry") || "").trim() || null;

  const supabase = await createClient();
  const { error } = await supabase.from("companies").insert({
    workspace_id: workspace.id,
    name,
    domain,
    website,
    phone,
    industry,
  });

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma empresa com esse domínio neste workspace." };
    return { error: error.message };
  }

  revalidatePath("/empresas");
  return { error: null, ok: true };
}

// Autocomplete usado no form de contato/tarefa pra vincular a uma empresa existente.
export async function searchCompanies(workspaceId: string, query: string): Promise<CompanyRow[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace || workspace.id !== workspaceId) return [];

  const supabase = await createClient();
  let request = supabase
    .from("companies")
    .select("id, name, domain, website, phone, industry, custom_fields, created_at")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })
    .limit(20);

  const trimmed = query.trim();
  if (trimmed) request = request.ilike("name", `%${trimmed}%`);

  const { data } = await request;
  return data || [];
}

export type CompanyNote = { id: string; author_name: string | null; content: string; created_at: string };
export type CompanyDetail = CompanyRow & { updated_at: string };
export type CompanyContactRef = { id: string; name: string | null; phone: string | null; email: string | null };

export async function getCompanyDetail(companyId: string): Promise<{
  company: CompanyDetail;
  notes: CompanyNote[];
  contacts: CompanyContactRef[];
} | null> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const supabase = await createClient();
  const [{ data: company }, { data: notes }, { data: contacts }] = await Promise.all([
    supabase
      .from("companies")
      .select("id, name, domain, website, phone, industry, custom_fields, created_at, updated_at")
      .eq("id", companyId)
      .eq("workspace_id", workspace.id)
      .maybeSingle(),
    supabase
      .from("company_notes")
      .select("id, author_name, content, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false }),
    supabase
      .from("contacts")
      .select("id, name, phone, email")
      .eq("company_id", companyId)
      .eq("workspace_id", workspace.id),
  ]);
  if (!company) return null;

  return { company, notes: notes || [], contacts: contacts || [] };
}

export async function updateCompanyInfo(
  companyId: string,
  fields: { name: string; domain: string; website: string; phone: string; industry: string; customFields: Record<string, string> }
): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const name = fields.name.trim();
  if (!name) return { error: "Informe o nome da empresa." };

  const cleanFields = Object.fromEntries(
    Object.entries(fields.customFields)
      .map(([k, v]) => [k.trim(), v.trim()])
      .filter(([k, v]) => k && v)
  );

  const supabase = await createClient();
  const { error } = await supabase
    .from("companies")
    .update({
      name,
      domain: normalizeDomain(fields.domain),
      website: fields.website.trim() || null,
      phone: fields.phone.trim() || null,
      industry: fields.industry.trim() || null,
      custom_fields: cleanFields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId)
    .eq("workspace_id", workspace.id);
  if (error) {
    if (error.code === "23505") return { error: "Já existe outra empresa com esse domínio." };
    return { error: "Não foi possível salvar." };
  }

  revalidatePath("/empresas");
  revalidatePath("/crm");
  return { error: null, ok: true };
}

export async function addCompanyNote(companyId: string, content: string): Promise<ActionResult> {
  const trimmed = content.trim();
  if (!trimmed) return { error: "Escreva alguma coisa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const authorName = await getCurrentUserName();
  const supabase = await createClient();
  const { error } = await supabase.from("company_notes").insert({
    company_id: companyId,
    workspace_id: workspace.id,
    author_name: authorName,
    content: trimmed,
  });
  if (error) return { error: "Não foi possível salvar a observação." };

  revalidatePath("/empresas");
  return { error: null, ok: true };
}

export async function deleteCompany(id: string): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase.from("companies").delete().eq("id", id).eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível excluir a empresa." };

  revalidatePath("/empresas");
  revalidatePath("/crm");
  return { error: null, ok: true };
}

// Vincula/desvincula um contato existente a uma empresa — chamado a partir do drawer de contato.
export async function linkContactToCompany(contactId: string, companyId: string | null): Promise<ActionResult> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("contacts")
    .update({ company_id: companyId })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (error) return { error: "Não foi possível vincular a empresa." };

  revalidatePath("/crm");
  revalidatePath("/contatos");
  revalidatePath("/empresas");
  return { error: null, ok: true };
}

// Fluxo "criar e já vincular" no drawer de contato — evita sair da tela pra cadastrar a empresa antes.
export async function createCompanyAndLinkContact(contactId: string, name: string): Promise<{ error: string | null; companyId?: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Informe o nome da empresa." };

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  const supabase = await createClient();
  const { data: company, error: createError } = await supabase
    .from("companies")
    .insert({ workspace_id: workspace.id, name: trimmed })
    .select("id")
    .single();
  if (createError || !company) return { error: "Não foi possível criar a empresa." };

  const { error: linkError } = await supabase
    .from("contacts")
    .update({ company_id: company.id })
    .eq("id", contactId)
    .eq("workspace_id", workspace.id);
  if (linkError) return { error: "Empresa criada, mas não foi possível vincular ao contato." };

  revalidatePath("/crm");
  revalidatePath("/contatos");
  revalidatePath("/empresas");
  return { error: null, companyId: company.id };
}
