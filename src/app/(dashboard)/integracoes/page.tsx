import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTeamMembers } from "@/app/actions/team";
import { listConnections, getAccessToken } from "@/lib/calendar/connections";
import { listEvents } from "@/lib/calendar/google-events";
import { availableSlots, DEFAULT_SLOT_TITLE } from "@/lib/calendar/slots";
import { IntegrationsView, type CloserRow } from "@/components/integrations-view";
import type { FacebookConnectionRow, FacebookPageRow } from "@/components/facebook-leads-section";
import type { FacebookForm } from "@/app/actions/facebook";

// Quantos "Marque aqui" livres cada closer conectado tem nos próximos 7 dias — é o jeito de a equipe
// ver, antes de ligar o agente, se o closer já abriu horário. Chamada ao Google com prazo curto: se
// demorar ou falhar, a linha mostra "—" em vez de travar a página.
async function countFreeSlots(admin: ReturnType<typeof createAdminClient>, teamMemberId: string): Promise<number | null> {
  const now = new Date();
  const work = (async () => {
    const token = await getAccessToken(admin, teamMemberId);
    const events = await listEvents(token, now, new Date(now.getTime() + 7 * 86_400_000), DEFAULT_SLOT_TITLE);
    return availableSlots(events, { slotTitle: DEFAULT_SLOT_TITLE, minNoticeHours: 0, daysAhead: 7, now }).length;
  })();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000));
  return Promise.race([work.catch(() => null), timeout]);
}

export default async function IntegracoesPage({ searchParams }: { searchParams: Promise<{ facebook?: string }> }) {
  const { facebook: facebookStatus } = await searchParams;
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const admin = createAdminClient();
  const [members, connections] = await Promise.all([listTeamMembers(), listConnections(admin, workspace.id)]);
  const byMember = new Map(connections.map((c) => [c.team_member_id, c]));
  const active = members.filter((m) => m.active);

  const rows: CloserRow[] = await Promise.all(
    active.map(async (m) => {
      const conn = byMember.get(m.id);
      const freeSlots = conn?.status === "conectado" ? await countFreeSlots(admin, m.id) : null;
      return {
        id: m.id,
        name: m.name,
        role: m.role,
        status: conn ? conn.status : "desconectado",
        accountEmail: conn?.account_email ?? null,
        freeSlots,
      };
    })
  );

  // Facebook: conta conectada, páginas autorizadas e formulários com a etiqueta de cada um. Token de página
  // nunca sai do servidor (a consulta lê só as colunas de exibição).
  const { data: fbConn } = await admin.from("facebook_connections").select("id, fb_user_name").eq("workspace_id", workspace.id).order("connected_at").limit(1).maybeSingle();
  const { data: fbPages } = await admin.from("facebook_pages").select("page_id, page_name").eq("workspace_id", workspace.id).eq("status", "ativa").order("page_name");
  const { data: fbForms } = await admin.from("facebook_lead_forms").select("page_id, form_id, form_name, enabled, tag").eq("workspace_id", workspace.id);
  const formsByPage = new Map<string, FacebookForm[]>();
  for (const f of fbForms || []) {
    const list = formsByPage.get(f.page_id as string) ?? [];
    list.push({ id: f.form_id as string, name: (f.form_name as string) || (f.form_id as string), enabled: Boolean(f.enabled), tag: (f.tag as string) || "" });
    formsByPage.set(f.page_id as string, list);
  }
  const facebookConnection: FacebookConnectionRow = fbConn ? { id: fbConn.id as string, name: (fbConn.fb_user_name as string) || null } : null;
  const facebookPages: FacebookPageRow[] = (fbPages || []).map((p) => ({
    id: p.page_id as string,
    name: (p.page_name as string) || (p.page_id as string),
    forms: formsByPage.get(p.page_id as string) ?? [],
  }));

  return (
    <IntegrationsView
      workspaceName={workspace.name}
      closers={rows}
      facebook={{ connection: facebookConnection, pages: facebookPages, canManage: true, status: facebookStatus ?? null }}
    />
  );
}
