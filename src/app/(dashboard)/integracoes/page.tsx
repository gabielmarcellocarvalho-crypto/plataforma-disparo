import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { listTeamMembers } from "@/app/actions/team";
import { listConnections, getAccessToken } from "@/lib/calendar/connections";
import { listEvents } from "@/lib/calendar/google-events";
import { availableSlots, DEFAULT_SLOT_TITLE } from "@/lib/calendar/slots";
import { IntegrationsView, type CloserRow } from "@/components/integrations-view";

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

export default async function IntegracoesPage() {
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

  return <IntegrationsView workspaceName={workspace.name} closers={rows} />;
}
