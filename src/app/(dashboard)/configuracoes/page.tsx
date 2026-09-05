import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { WhatsappInstancesManager } from "@/components/whatsapp-instances-manager";
import type { WhatsappChannel } from "@/lib/whatsapp-channel";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { WorkspacePlanEditor } from "@/components/workspace-plan-editor";
import { WorkspaceFeaturesEditor } from "@/components/workspace-features-picker";
import { EmailFromEditor } from "@/components/email-from-editor";
import { WorkspaceLogoEditor } from "@/components/workspace-logo-editor";
import { listApiKeys } from "@/app/actions/api-keys";
import { resolveWorkspacePlan } from "@/lib/workspace-plan";

export default async function ConfiguracoesPage() {
  await assertPageAccess("/configuracoes");
  const { workspace, isStaff, hiddenPages } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: instances }, apiKeys, { data: workspaceRow }] = await Promise.all([
    workspace
      ? supabase.from("whatsapp_instances").select("id, connection_status, channel, department").eq("workspace_id", workspace.id).order("created_at")
      : Promise.resolve({ data: [] }),
    isStaff ? listApiKeys() : Promise.resolve([]),
    isStaff && workspace
      ? supabase.from("workspaces").select("plan, email_from, logo_url, brand_color").eq("id", workspace.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const currentPlan = resolveWorkspacePlan(workspaceRow?.plan);

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Configurações</h1>
        <p className="text-text-muted text-sm mt-1">
          {isStaff ? `Conexões do workspace ${workspace?.name}.` : "Conecte ou reconecte seu número de WhatsApp aqui."}
        </p>
      </div>

      {isStaff && workspace && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-2xl">
          <h3 className="font-bold text-[15px] mb-1">Funções ativas</h3>
          <p className="text-xs text-text-muted mb-4">
            O que esse cliente usa da plataforma. O que estiver desmarcado some do menu e fica
            inacessível por URL — pra ele e pra agência.
          </p>
          <WorkspaceFeaturesEditor workspaceId={workspace.id} initialHidden={hiddenPages} />
        </div>
      )}

      {isStaff && (
        <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
          <h3 className="font-bold text-[15px] mb-1">Plano do workspace</h3>
          <p className="text-xs text-text-muted mb-4">Define até onde vai o funil de conversão mostrado na Visão geral desse cliente.</p>
          {workspace && <WorkspacePlanEditor workspaceId={workspace.id} currentPlan={currentPlan} />}
        </div>
      )}

      <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
        <h3 className="font-bold text-[15px] mb-1">WhatsApp — disparo em massa</h3>
        <p className="text-xs text-text-muted mb-4">
          {isStaff
            ? "Número de disparo em massa (sem IA). Pra número com IA respondendo, use a tela de Agentes."
            : "Se o número desconectar (QR expirado, troca de aparelho), reconecte por aqui."}
        </p>
        <WhatsappInstancesManager
          initialInstances={(instances || []).map((i) => ({
            id: i.id,
            channel: i.channel as WhatsappChannel,
            department: i.department,
            connection_status: i.connection_status,
          }))}
        />
      </div>

      {isStaff && (
        <>
          <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
            <h3 className="font-bold text-[15px] mb-1">E-mail</h3>
            <p className="text-xs text-text-muted mb-4">Remetente das campanhas de e-mail desse workspace.</p>
            {workspace && <EmailFromEditor workspaceId={workspace.id} current={workspaceRow?.email_from ?? null} />}
          </div>

          <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
            <h3 className="font-bold text-[15px] mb-1">Logo e cor de marca</h3>
            <p className="text-xs text-text-muted mb-4">Aparece no cabeçalho dos e-mails de campanha desse workspace.</p>
            {workspace && (
              <WorkspaceLogoEditor
                workspaceId={workspace.id}
                currentLogoUrl={workspaceRow?.logo_url ?? null}
                currentBrandColor={workspaceRow?.brand_color ?? null}
              />
            )}
          </div>

          <div className="bg-surface border border-border rounded-lg shadow-sm p-5 max-w-xl">
            <h3 className="font-bold text-[15px] mb-1">API — receber leads de fora</h3>
            <ApiKeysManager keys={apiKeys} siteUrl={siteUrl} />
          </div>
        </>
      )}
    </div>
  );
}
