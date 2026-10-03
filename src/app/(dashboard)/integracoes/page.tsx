import { getCurrentWorkspace } from "@/lib/workspace";
import { createAdminClient } from "@/lib/supabase/admin";
import { listConnections } from "@/lib/calendar/connections";
import { IntegrationsView } from "@/components/integrations-view";

// Página de cards: cada integração abre a própria página de configuração. Aqui só os números que
// aparecem no card (conectados, páginas), sem consultar o Google nem o Facebook ao vivo.
export default async function IntegracoesPage() {
  const { workspace } = await getCurrentWorkspace();
  if (!workspace) return null;

  const admin = createAdminClient();
  const [connections, { data: fbConn }, { data: fbPages }] = await Promise.all([
    listConnections(admin, workspace.id),
    admin.from("facebook_connections").select("id").eq("workspace_id", workspace.id).limit(1).maybeSingle(),
    admin.from("facebook_pages").select("page_id").eq("workspace_id", workspace.id).eq("status", "ativa"),
  ]);

  return (
    <IntegrationsView
      workspaceName={workspace.name}
      googleConnected={connections.filter((c) => c.status === "conectado").length}
      facebook={{ connected: Boolean(fbConn), pages: (fbPages || []).length }}
    />
  );
}
