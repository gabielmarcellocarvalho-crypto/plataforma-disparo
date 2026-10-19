import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, assertPageAccess } from "@/lib/workspace";
import { WhatsappInstancesManager } from "@/components/whatsapp-instances-manager";
import type { WhatsappChannel } from "@/lib/whatsapp-channel";
import { ApiKeysManager } from "@/components/api-keys-manager";
import { LeadQualificationEditor } from "@/components/lead-qualification-editor";
import { resolveQualification } from "@/lib/lead-qualification";
import { WorkspacePlanEditor } from "@/components/workspace-plan-editor";
import { WorkspaceFeaturesEditor } from "@/components/workspace-features-picker";
import { EmailFromEditor } from "@/components/email-from-editor";
import { EmailDomainsManager } from "@/components/email-domains-manager";
import { WorkspaceLogoEditor } from "@/components/workspace-logo-editor";
import { listApiKeys } from "@/app/actions/api-keys";
import { listEmailDomains } from "@/app/actions/email-domains";
import { resolveWorkspacePlan } from "@/lib/workspace-plan";
import { createAdminClient } from "@/lib/supabase/admin";
import { ChatbotEditor, type ChatbotInstanceItem } from "@/components/chatbot-editor";
import { normalizeChatbotConfig } from "@/lib/chatbot";
import { listCustomFieldDefs } from "@/app/actions/custom-fields";
import { resolveStageLabels } from "@/lib/crm-stages";
import { SectionNav, type NavSection } from "@/components/section-nav";

export default async function ConfiguracoesPage() {
  await assertPageAccess("/configuracoes");
  const { workspace, isStaff, hiddenPages } = await getCurrentWorkspace();
  const supabase = await createClient();

  const [{ data: instances }, apiKeys, { data: workspaceRow }, emailDomains] = await Promise.all([
    workspace
      ? supabase.from("whatsapp_instances").select("id, connection_status, channel, department").eq("workspace_id", workspace.id).order("created_at")
      : Promise.resolve({ data: [] }),
    isStaff ? listApiKeys() : Promise.resolve([]),
    isStaff && workspace
      ? supabase.from("workspaces").select("plan, email_from, logo_url, brand_color, lead_qualification").eq("id", workspace.id).maybeSingle()
      : Promise.resolve({ data: null }),
    isStaff ? listEmailDomains() : Promise.resolve([]),
  ]);
  const currentPlan = resolveWorkspacePlan(workspaceRow?.plan);

  // Chatbot de mensagens iniciais: só números SEM agente de IA vinculado. Lido pelo servidor com
  // fallback — antes da migration 0077 a coluna `chatbot` não existe e a página não pode quebrar.
  let chatbotItems: ChatbotInstanceItem[] = [];
  let chatbotReady = false;
  const [fieldDefs, { data: stageRow }] = workspace
    ? await Promise.all([listCustomFieldDefs(), supabase.from("workspaces").select("crm_stage_labels").eq("id", workspace.id).maybeSingle()])
    : [[], { data: null }];
  if (workspace) {
    const admin = createAdminClient();
    const [{ data: botRows, error: botError }, { data: linked }] = await Promise.all([
      admin.from("whatsapp_instances").select("id, channel, department, chatbot").eq("workspace_id", workspace.id).order("created_at"),
      admin.from("agents").select("whatsapp_instance_id").eq("workspace_id", workspace.id).not("whatsapp_instance_id", "is", null),
    ]);
    chatbotReady = !botError;
    const withAgent = new Set((linked || []).map((a) => a.whatsapp_instance_id as string));
    const channelName: Record<string, string> = { evolution: "WhatsApp (QR code)", "360dialog": "360dialog", metacloud: "API oficial Meta" };
    const departmentName: Record<string, string> = { vendas: "Vendas", financeiro: "Financeiro" };
    chatbotItems = (botRows || [])
      .filter((r) => !withAgent.has(r.id))
      .map((r) => ({
        id: r.id,
        label: `${departmentName[r.department] || r.department} · ${channelName[r.channel] || r.channel}`,
        config: normalizeChatbotConfig(r.chatbot),
      }));
  }

  const h = await headers();
  const siteUrl = `${h.get("x-forwarded-proto") || "https"}://${h.get("host") || ""}`;

  const card = "bg-surface border border-border rounded-lg shadow-sm p-5";

  // Página dividida em seções com navegação lateral, no lugar da página única longa. Cliente (não staff)
  // só vê as seções de WhatsApp e chatbot, igual antes.
  const sections: NavSection[] = [
    ...(isStaff && workspace
      ? [
          {
            id: "funcoes",
            label: "Funções ativas",
            icon: "toggle",
            content: (
              <div className={`${card} max-w-3xl`}>
                <h3 className="font-bold text-[15px] mb-1">Funções ativas</h3>
                <p className="text-xs text-text-muted mb-4">
                  O que esse cliente usa da plataforma. O que estiver desligado some do menu e fica
                  inacessível por URL — pra ele e pra agência.
                </p>
                <WorkspaceFeaturesEditor workspaceId={workspace.id} initialHidden={hiddenPages} />
              </div>
            ),
          },
          {
            id: "plano",
            label: "Plano do workspace",
            icon: "plan",
            content: (
              <div className={`${card} max-w-xl`}>
                <h3 className="font-bold text-[15px] mb-1">Plano do workspace</h3>
                <p className="text-xs text-text-muted mb-4">Define até onde vai o funil de conversão mostrado na Visão geral desse cliente.</p>
                <WorkspacePlanEditor workspaceId={workspace.id} currentPlan={currentPlan} />
              </div>
            ),
          },
        ]
      : []),
    {
      id: "whatsapp",
      label: "WhatsApp",
      icon: "whatsapp",
      content: (
        <div className={`${card} max-w-xl`}>
          <h3 className="font-bold text-[15px] mb-1">WhatsApp — disparo em massa</h3>
          <p className="text-xs text-text-muted mb-4">
            {isStaff
              ? "Número de disparo em massa (sem IA). Pra número com IA respondendo, use a tela de Agentes."
              : "Se o número desconectar (QR expirado, troca de aparelho), reconecte por aqui."}
          </p>
          <WhatsappInstancesManager
            canRemove={isStaff}
            initialInstances={(instances || []).map((i) => ({
              id: i.id,
              channel: i.channel as WhatsappChannel,
              department: i.department,
              connection_status: i.connection_status,
            }))}
          />
        </div>
      ),
    },
    ...(workspace && chatbotReady
      ? [
          {
            id: "chatbot",
            label: "Mensagens iniciais",
            icon: "bot",
            content: (
              <div className={`${card} max-w-5xl`}>
                <h3 className="font-bold text-[15px] mb-1">Mensagens iniciais (chatbot)</h3>
                <p className="text-xs text-text-muted mb-4">
                  Primeiro atendimento automático em número sem IA: perguntas e menu que preenchem o cadastro, aplicam etiquetas e
                  etapa no Pipeline e direcionam o lead antes de a equipe assumir.
                </p>
                <ChatbotEditor
                  instances={chatbotItems}
                  fieldDefs={fieldDefs.map((d) => ({ key: d.key, label: d.label, type: d.type, options: d.options }))}
                  stageLabels={resolveStageLabels(stageRow?.crm_stage_labels)}
                />
              </div>
            ),
          },
        ]
      : []),
    ...(isStaff && workspace
      ? [
          {
            id: "email",
            label: "E-mail e domínios",
            icon: "mail",
            content: (
              <>
                <div className={`${card} max-w-xl`}>
                  <h3 className="font-bold text-[15px] mb-1">E-mail</h3>
                  <p className="text-xs text-text-muted mb-4">Remetente das campanhas de e-mail desse workspace.</p>
                  <EmailFromEditor workspaceId={workspace.id} current={workspaceRow?.email_from ?? null} />
                </div>
                <div className={`${card} max-w-2xl`}>
                  <h3 className="font-bold text-[15px] mb-1">Domínios de e-mail</h3>
                  <p className="text-xs text-text-muted mb-4">
                    O domínio do remetente acima precisa aparecer aqui como verificado, senão o envio falha.
                  </p>
                  <EmailDomainsManager domains={emailDomains} />
                </div>
              </>
            ),
          },
          {
            id: "marca",
            label: "Logo e marca",
            icon: "image",
            content: (
              <div className={`${card} max-w-xl`}>
                <h3 className="font-bold text-[15px] mb-1">Logo e cor de marca</h3>
                <p className="text-xs text-text-muted mb-4">Aparece no cabeçalho dos e-mails de campanha desse workspace.</p>
                <WorkspaceLogoEditor
                  workspaceId={workspace.id}
                  currentLogoUrl={workspaceRow?.logo_url ?? null}
                  currentBrandColor={workspaceRow?.brand_color ?? null}
                />
              </div>
            ),
          },
          {
            id: "api",
            label: "API",
            icon: "code",
            content: (
              <div className="flex flex-col gap-5 max-w-xl">
                <div className={card}>
                  <h3 className="font-bold text-[15px] mb-1">Receber leads (de fora pra cá)</h3>
                  <ApiKeysManager keys={apiKeys} siteUrl={siteUrl} kind="entrada" />
                </div>
                <div className={card}>
                  <h3 className="font-bold text-[15px] mb-1">Enviar dados (pra dashboard e BI)</h3>
                  <ApiKeysManager keys={apiKeys} siteUrl={siteUrl} kind="leitura" />
                  <h4 className="font-bold text-sm mt-6 mb-1">Classificação dos leads (MQL, SQL)</h4>
                  <LeadQualificationEditor
                    initial={resolveQualification(workspaceRow?.lead_qualification)}
                    stageLabels={resolveStageLabels(stageRow?.crm_stage_labels)}
                  />
                </div>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Configurações</h1>
        <p className="text-text-muted text-sm mt-1">
          {isStaff ? `Conexões e preferências do workspace ${workspace?.name}.` : "Conecte ou reconecte seu número de WhatsApp aqui."}
        </p>
      </div>

      <SectionNav sections={sections} />
    </div>
  );
}
