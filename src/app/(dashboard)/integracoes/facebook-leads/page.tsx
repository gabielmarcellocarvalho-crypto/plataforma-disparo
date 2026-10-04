import Link from "next/link";
import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { FacebookLeadsSection, type FacebookConnectionRow, type FacebookPageRow } from "@/components/facebook-leads-section";
import type { FacebookForm } from "@/app/actions/facebook";

// Página de configuração do Facebook — leads de formulário. Token de página nunca sai do servidor
// (a consulta lê só as colunas de exibição).
export default async function FacebookLeadsPage({ searchParams }: { searchParams: Promise<{ facebook?: string }> }) {
  const { facebook: status } = await searchParams;
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const admin = createAdminClient();
  const { data: fbConn } = await admin.from("facebook_connections").select("id, fb_user_name").eq("workspace_id", workspace.id).order("connected_at").limit(1).maybeSingle();
  const { data: fbPages } = await admin.from("facebook_pages").select("page_id, page_name, status").eq("workspace_id", workspace.id).order("page_name");
  const { data: fbForms } = await admin.from("facebook_lead_forms").select("page_id, form_id, form_name, enabled, tag").eq("workspace_id", workspace.id);

  const formsByPage = new Map<string, FacebookForm[]>();
  for (const f of fbForms || []) {
    const list = formsByPage.get(f.page_id as string) ?? [];
    list.push({ id: f.form_id as string, name: (f.form_name as string) || (f.form_id as string), enabled: Boolean(f.enabled), tag: (f.tag as string) || "" });
    formsByPage.set(f.page_id as string, list);
  }
  const connection: FacebookConnectionRow = fbConn ? { id: fbConn.id as string, name: (fbConn.fb_user_name as string) || null } : null;
  const pages: FacebookPageRow[] = (fbPages || []).map((p) => ({
    id: p.page_id as string,
    name: (p.page_name as string) || (p.page_id as string),
    active: p.status === "ativa",
    forms: formsByPage.get(p.page_id as string) ?? [],
  }));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/integracoes" className="text-xs font-bold text-text-muted hover:text-text">← Integrações</Link>
        <h1 className="text-2xl font-extrabold tracking-tight mt-1">Facebook — leads</h1>
        <p className="text-text-muted text-sm mt-1">Formulários de anúncio de {workspace.name}.</p>
      </div>
      <FacebookLeadsSection connection={connection} pages={pages} canManage={true} status={status ?? null} />
    </div>
  );
}
