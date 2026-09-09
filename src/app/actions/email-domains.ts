"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, isCurrentUserStaff } from "@/lib/workspace";
import { createDomain, getDomain, verifyDomain, deleteDomain, type DnsRecord } from "@/lib/resend";

export type EmailDomainSummary = {
  id: string;
  domain_name: string;
  status: string;
  dns_records: DnsRecord[];
  last_checked_at: string | null;
};

export type EmailDomainResult = { error: string | null };

// O Resend é a fonte da verdade do status; a tabela é só um espelho pra não bater na API deles a
// cada render. Por isso todo caminho que fala com o Resend regrava o status e os registros.
function syncPayload(status: string, records: DnsRecord[] | undefined) {
  return {
    status: status || "pending",
    dns_records: records ?? [],
    last_checked_at: new Date().toISOString(),
  };
}

export async function listEmailDomains(): Promise<EmailDomainSummary[]> {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return [];

  const supabase = await createClient();
  const { data } = await supabase
    .from("email_domains")
    .select("id, domain_name, status, dns_records, last_checked_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (data ?? []) as EmailDomainSummary[];
}

export async function addEmailDomain(domainName: string): Promise<EmailDomainResult> {
  if (!(await isCurrentUserStaff())) return { error: "Só a agência pode adicionar domínio." };

  // Aceita o que o usuário colar (com https://, com www, com barra no fim) e reduz pro domínio nu,
  // que é o que o Resend espera. Colar a URL do site do cliente é o erro mais provável aqui.
  const clean = domainName
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(clean)) {
    return { error: "Domínio inválido — use o formato dominio.com.br, sem http e sem www." };
  }

  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return { error: "Nenhum workspace ativo." };

  let created;
  try {
    created = await createDomain(clean);
  } catch (e) {
    return { error: `Resend recusou o domínio: ${(e as Error).message}` };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("email_domains").insert({
    workspace_id: workspace.id,
    resend_domain_id: created.id,
    domain_name: clean,
    ...syncPayload(created.status, created.records),
  });
  if (error) {
    // O domínio já existe no Resend mas não temos linha pra ele — deixar assim faria o próximo
    // "adicionar" falhar pra sempre com "already exists" e sem nada na tela.
    await deleteDomain(created.id).catch(() => {});
    return { error: "Não foi possível salvar o domínio. Ele já está cadastrado neste workspace?" };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}

// Relê o status no Resend sem pedir nova verificação — serve pro caso do DNS já ter propagado e a
// tela ainda mostrar "pendente".
export async function refreshEmailDomain(id: string): Promise<EmailDomainResult> {
  if (!(await isCurrentUserStaff())) return { error: "Só a agência pode conferir domínio." };

  const supabase = await createClient();
  const { data: row } = await supabase.from("email_domains").select("resend_domain_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Domínio não encontrado." };

  try {
    const domain = await getDomain(row.resend_domain_id);
    await supabase.from("email_domains").update(syncPayload(domain.status, domain.records)).eq("id", id);
  } catch (e) {
    return { error: `Não foi possível consultar o Resend: ${(e as Error).message}` };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}

// Pede ao Resend pra checar o DNS agora. O POST de verify não devolve o status novo, então relemos o
// domínio em seguida — senão a tela continuaria em "pendente" mesmo num domínio recém-aprovado.
export async function verifyEmailDomain(id: string): Promise<EmailDomainResult> {
  if (!(await isCurrentUserStaff())) return { error: "Só a agência pode verificar domínio." };

  const supabase = await createClient();
  const { data: row } = await supabase.from("email_domains").select("resend_domain_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Domínio não encontrado." };

  try {
    await verifyDomain(row.resend_domain_id);
    const domain = await getDomain(row.resend_domain_id);
    await supabase.from("email_domains").update(syncPayload(domain.status, domain.records)).eq("id", id);
  } catch (e) {
    return { error: `O Resend não conseguiu verificar: ${(e as Error).message}` };
  }

  revalidatePath("/configuracoes");
  return { error: null };
}

export async function removeEmailDomain(id: string): Promise<EmailDomainResult> {
  if (!(await isCurrentUserStaff())) return { error: "Só a agência pode remover domínio." };

  const supabase = await createClient();
  const { data: row } = await supabase.from("email_domains").select("resend_domain_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Domínio não encontrado." };

  // Apagar só no Resend e falhar aqui deixaria uma linha fantasma que diz "verificado" sobre um
  // domínio que não existe mais. A ordem inversa (linha primeiro) deixaria lixo no Resend, que é
  // menos grave: o domínio some da tela de qualquer jeito e pode ser removido lá manualmente.
  const { error } = await supabase.from("email_domains").delete().eq("id", id);
  if (error) return { error: "Não foi possível remover o domínio." };
  await deleteDomain(row.resend_domain_id).catch(() => {});

  revalidatePath("/configuracoes");
  return { error: null };
}
